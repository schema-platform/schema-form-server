/**
 * MongoDB-backed checkpointer for LangGraph.
 *
 * Replaces MemorySaver with persistent storage via Mongoose.
 * Thread state survives process restarts and serverless cold starts.
 *
 * Collections:
 * - ai_checkpoints: checkpoint snapshots per thread
 * - ai_checkpoint_writes: pending writes linked to checkpoints
 *
 * Note: Uses types from @langchain/langgraph-checkpoint v1.0.4 which has
 * async dumpsTyped, but the runtime behavior is compatible with v0.0.18
 * used internally by @langchain/langgraph. The compile() call in graph.ts
 * uses a type assertion to bridge the version gap.
 */

import type { RunnableConfig } from '@langchain/core/runnables'
import {
  BaseCheckpointSaver,
  copyCheckpoint,
  getCheckpointId,
  WRITES_IDX_MAP,
  TASKS,
} from '@langchain/langgraph-checkpoint'
import type {
  Checkpoint,
  CheckpointTuple,
  CheckpointListOptions,
  ChannelVersions,
  SerializerProtocol,
  PendingWrite,
  CheckpointPendingWrite,
  CheckpointMetadata,
  SendProtocol,
} from '@langchain/langgraph-checkpoint'
import { CheckpointModel, CheckpointWriteModel } from './checkpointModels.js'

export class MongoDBCheckpointer extends BaseCheckpointSaver {
  constructor(serde?: SerializerProtocol) {
    super(serde)
  }

  /**
   * Retrieve pending sends from parent checkpoint's writes.
   */
  private async _getPendingSends(
    threadId: string,
    checkpointNs: string,
    parentCheckpointId?: string,
  ): Promise<SendProtocol[]> {
    if (parentCheckpointId === undefined) return []

    const writes = await CheckpointWriteModel.find({
      thread_id: threadId,
      checkpoint_ns: checkpointNs,
      checkpoint_id: parentCheckpointId,
      channel: TASKS,
    }).lean()

    return Promise.all(
      writes.map((w) => this.serde.loadsTyped('json', w.value)),
    )
  }

  /**
   * Get a single checkpoint tuple by config.
   */
  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = config.configurable?.thread_id as string | undefined
    const checkpointNs = (config.configurable?.checkpoint_ns as string) ?? ''
    const checkpointId = getCheckpointId(config)

    if (checkpointId) {
      const doc = await CheckpointModel.findOne({
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: checkpointId,
      }).lean()

      if (doc) {
        return this._docToTuple(doc, threadId!, checkpointNs, config)
      }
    } else if (threadId) {
      const doc = await CheckpointModel.findOne({
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
      })
        .sort({ checkpoint_id: -1 })
        .lean()

      if (doc) {
        return this._docToTuple(doc, threadId, checkpointNs)
      }
    }

    return undefined
  }

  /**
   * Convert a MongoDB document to a CheckpointTuple.
   */
  private async _docToTuple(
    doc: {
      checkpoint_id: string
      parent_checkpoint_id?: string
      checkpoint: string
      metadata: string
    },
    threadId: string,
    checkpointNs: string,
    baseConfig?: RunnableConfig,
  ): Promise<CheckpointTuple> {
    const checkpointId = doc.checkpoint_id

    const pendingSends = await this._getPendingSends(
      threadId,
      checkpointNs,
      doc.parent_checkpoint_id,
    )

    const deserializedCheckpoint: Checkpoint = {
      ...(await this.serde.loadsTyped('json', doc.checkpoint)),
      pending_sends: pendingSends,
    }

    const writes = await CheckpointWriteModel.find({
      thread_id: threadId,
      checkpoint_ns: checkpointNs,
      checkpoint_id: checkpointId,
    }).lean()

    const pendingWrites: CheckpointPendingWrite[] = await Promise.all(
      writes.map(async (w): Promise<CheckpointPendingWrite> => [
        w.task_id,
        w.channel,
        await this.serde.loadsTyped('json', w.value),
      ]),
    )

    const config: RunnableConfig = baseConfig ?? {
      configurable: {
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: checkpointId,
      },
    }

    const result: CheckpointTuple = {
      config,
      checkpoint: deserializedCheckpoint,
      metadata: await this.serde.loadsTyped('json', doc.metadata),
      pendingWrites,
    }

    if (doc.parent_checkpoint_id !== undefined) {
      result.parentConfig = {
        configurable: {
          thread_id: threadId,
          checkpoint_ns: checkpointNs,
          checkpoint_id: doc.parent_checkpoint_id,
        },
      }
    }

    return result
  }

  /**
   * List checkpoint tuples for a thread.
   */
  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions,
  ): AsyncGenerator<CheckpointTuple> {
    const { before, limit, filter } = options ?? {}
    const configThreadId = config.configurable?.thread_id as string | undefined
    const configNs = config.configurable?.checkpoint_ns as string | undefined
    const configCheckpointId = config.configurable?.checkpoint_id as string | undefined

    const threadIds = configThreadId
      ? [configThreadId]
      : (await CheckpointModel.distinct('thread_id').lean())

    for (const threadId of threadIds) {
      const query: Record<string, unknown> = { thread_id: threadId }

      if (configNs !== undefined) {
        query.checkpoint_ns = configNs
      }

      if (configCheckpointId) {
        query.checkpoint_id = configCheckpointId
      }

      if (before?.configurable?.checkpoint_id) {
        query.checkpoint_id = { $gt: before.configurable.checkpoint_id as string }
      }

      let cursor = CheckpointModel.find(query)
        .sort({ checkpoint_id: -1 })

      if (limit !== undefined) {
        cursor = cursor.limit(limit)
      }

      const docs = await cursor.lean()

      for (const doc of docs) {
        const metadata = await this.serde.loadsTyped('json', doc.metadata)

        if (filter) {
          const matches = Object.entries(filter).every(
            ([key, value]) => metadata[key] === value,
          )
          if (!matches) continue
        }

        yield await this._docToTuple(
          doc,
          threadId,
          doc.checkpoint_ns ?? '',
        )
      }
    }
  }

  /**
   * Save a checkpoint.
   */
  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: ChannelVersions,
  ): Promise<RunnableConfig> {
    const preparedCheckpoint = copyCheckpoint(checkpoint)
    // Remove pending_sends before serialization (rebuilt on read)
    const { pending_sends: _ps, ...checkpointForStorage } = preparedCheckpoint as Checkpoint & Record<string, unknown>

    const threadId = config.configurable?.thread_id as string | undefined
    const checkpointNs = (config.configurable?.checkpoint_ns as string) ?? ''

    if (threadId === undefined) {
      throw new Error(
        'Failed to put checkpoint. Missing "thread_id" in config.configurable.',
      )
    }

    const [, serializedCheckpoint] = await this.serde.dumpsTyped(checkpointForStorage)
    const [, serializedMetadata] = await this.serde.dumpsTyped(metadata)
    const checkpointStr = this._uint8ToString(serializedCheckpoint)
    const metadataStr = this._uint8ToString(serializedMetadata)

    await CheckpointModel.findOneAndUpdate(
      {
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: preparedCheckpoint.id,
      },
      {
        $set: {
          checkpoint: checkpointStr,
          metadata: metadataStr,
          parent_checkpoint_id: config.configurable?.checkpoint_id as string | undefined,
        },
        $setOnInsert: {
          thread_id: threadId,
          checkpoint_ns: checkpointNs,
          checkpoint_id: preparedCheckpoint.id,
          created_at: new Date(),
        },
      },
      { upsert: true },
    )

    return {
      configurable: {
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: preparedCheckpoint.id,
      },
    }
  }

  /**
   * Store pending writes linked to a checkpoint.
   */
  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string,
  ): Promise<void> {
    const threadId = config.configurable?.thread_id as string | undefined
    const checkpointNs = config.configurable?.checkpoint_ns as string | undefined
    const checkpointId = config.configurable?.checkpoint_id as string | undefined

    if (threadId === undefined) {
      throw new Error(
        'Failed to put writes. Missing "thread_id" in config.configurable.',
      )
    }
    if (checkpointId === undefined) {
      throw new Error(
        'Failed to put writes. Missing "checkpoint_id" in config.configurable.',
      )
    }

    const bulkOps = await Promise.all(
      writes
        .map(async ([channel, value], idx) => {
          const writeIdx = WRITES_IDX_MAP[channel] ?? idx
          if (writeIdx < 0) return null

          const [, serializedValue] = await this.serde.dumpsTyped(value)
          const valueStr = this._uint8ToString(serializedValue)

          return {
            updateOne: {
              filter: {
                thread_id: threadId,
                checkpoint_ns: checkpointNs ?? '',
                checkpoint_id: checkpointId,
                task_id: taskId,
                idx: writeIdx,
              },
              update: {
                $setOnInsert: {
                  thread_id: threadId,
                  checkpoint_ns: checkpointNs ?? '',
                  checkpoint_id: checkpointId,
                  task_id: taskId,
                  idx: writeIdx,
                  channel,
                  value: valueStr,
                },
              },
              upsert: true,
            },
          }
        }),
    )

    const validOps = bulkOps.filter(
      (op): op is NonNullable<typeof op> => op !== null,
    )

    if (validOps.length > 0) {
      await CheckpointWriteModel.bulkWrite(validOps)
    }
  }

  /**
   * Delete all checkpoints and writes for a thread.
   */
  async deleteThread(threadId: string): Promise<void> {
    await Promise.all([
      CheckpointModel.deleteMany({ thread_id: threadId }),
      CheckpointWriteModel.deleteMany({ thread_id: threadId }),
    ])
  }

  /**
   * Convert Uint8Array to string for MongoDB storage.
   */
  private _uint8ToString(data: Uint8Array | string): string {
    if (typeof data === 'string') return data
    return new TextDecoder().decode(data)
  }
}

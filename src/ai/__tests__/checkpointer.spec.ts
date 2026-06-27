/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest'
import { checkpointer } from '../graph/checkpointer.js'

describe('checkpointer', () => {
  it('exports a checkpointer instance', () => {
    expect(checkpointer).toBeDefined()
  })

  it('has the BaseCheckpointSaver interface (get/put methods)', () => {
    expect(typeof checkpointer.get).toBe('function')
    expect(typeof checkpointer.put).toBe('function')
  })

  it('has getTuple/list/putWrites methods', () => {
    expect(typeof checkpointer.getTuple).toBe('function')
    expect(typeof checkpointer.list).toBe('function')
    expect(typeof checkpointer.putWrites).toBe('function')
  })
})

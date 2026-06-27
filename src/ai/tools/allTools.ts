/**
 * Unified tool set — all agents can access all tools.
 *
 * Merges editorTools, flowTools, and schemaTools into a single array,
 * removing duplicates and ensuring all tools are available
 * to every agent.
 */

// Unified schema search (replaces duplicate search_schemas in editorTools + flowTools)
import { searchSchemasTool } from './schemaTools.js'

// Editor tools
import {
  getSchemaDetailTool,
  searchPublishedSchemasTool,
  getWidgetCatalogueTool,
  searchWidgetsByKeywordTool,
  validateSchemaTool,
  findFlowReferencesTool,
  updateSchemaTool,
} from './editorTools.js'

// Flow tools
import {
  searchFlowsTool,
  getFlowDetailTool,
  searchUsersTool,
  generateSchemaTool,
  validateFlowTool,
  saveAndBindSchemaTool,
  bindSchemaToFlowNodeTool,
  getFlowNodeSchemaTool,
  updateFlowTool,
} from './flowTools.js'

// Collaboration tools
import { requestCollaborationTool } from './collaborationTools.js'

// RAG tools
import { ragTools } from './ragTools.js'

// Widget tools
import { widgetTools } from './widgetTools.js'

// Industry tools
import { industryTools } from './industryTools.js'

// ────────────────────────────────────────────
// Unified tool array for ToolNode
// ────────────────────────────────────────────

export const allTools = [
  // Unified schema search
  searchSchemasTool,

  // Editor tools
  getSchemaDetailTool,
  searchPublishedSchemasTool,
  getWidgetCatalogueTool,
  searchWidgetsByKeywordTool,
  validateSchemaTool,
  findFlowReferencesTool,
  updateSchemaTool,

  // Flow tools
  searchFlowsTool,
  getFlowDetailTool,
  searchUsersTool,
  generateSchemaTool,
  validateFlowTool,
  saveAndBindSchemaTool,
  bindSchemaToFlowNodeTool,
  getFlowNodeSchemaTool,
  updateFlowTool,

  // Industry tools
  ...industryTools,

  // RAG tools
  ...ragTools,

  // Widget tools
  ...widgetTools,

  // Collaboration tools
  requestCollaborationTool,
]

import { app, webContents } from 'electron';
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  createSdkMcpServer,
  query,
  tool,
} from '@anthropic-ai/claude-agent-sdk';
import { blenderConnection } from './blender';

// In-engine Claude chat — uses the user's Claude Code subscription via the
// official Agent SDK (no API tokens billed). The SDK spawns the local `claude`
// CLI as a subprocess and routes requests through it, so the user's regular
// Claude Code quota is what's consumed.
//
// Conversation continuity is provided by Claude Code's session resume:
// we save the `session_id` returned in the SDK's result event and pass it
// back as `resume` for the next message. Our own JSON files at
// <userData>/conversations/<uuid>.json are the user-facing display state.

const SYSTEM_PROMPT = `You are HairyEngine's in-app assistant.
HairyEngine is an Electron + Three.js scene editor with Blender MCP integration, undo/redo, .hairy project files, a global asset library, and an auto-updater.

You have tools to drive a live Blender session and to mutate the HairyEngine scene. Use them when the user asks you to build, modify, or inspect 3D content — don't ask the user to run code themselves.

Blender tools:
- mcp__hairy__blender_execute_python: run Python. \`bpy\` is pre-imported; print things you want surfaced.
- mcp__hairy__blender_get_scene_info: list objects in the current Blender scene.

Engine tools (operate on the HairyEngine viewport, not Blender):
- mcp__hairy__engine_add_primitive: spawn a cube/sphere/etc. directly in the viewport.
- mcp__hairy__engine_list_scene: list objects in the HairyEngine scene.

Be concise and practical. When the user asks "make X in Blender" you call the Blender Python tool. When they ask "put a cube in the engine" you call the engine tool.`;

export type ChatRole = 'user' | 'assistant';

export type TextBlock = { type: 'text'; text: string };
export type ToolUseBlock = {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
};
export type ToolResultBlock = {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};
export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;
export type ChatContent = string | ContentBlock[];

export type ChatMessage = {
  role: ChatRole;
  content: ChatContent;
  timestamp: number;
};

export type Conversation = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  // Claude Code session for continuity — set after the first turn.
  sessionId?: string;
};

type StreamEvent =
  | { type: 'delta'; text: string }
  | {
      type: 'tool_call';
      toolUseId: string;
      name: string;
      input: Record<string, unknown>;
    }
  | {
      type: 'tool_result';
      toolUseId: string;
      content: string;
      is_error: boolean;
    }
  | { type: 'done'; usage?: Record<string, unknown> }
  | { type: 'error'; message: string };

// Renderer-side tool bridge (set from main/index.ts at startup).
type RendererInvokeFn = (
  tool: string,
  input: Record<string, unknown>,
) => Promise<string>;

let rendererInvoke: RendererInvokeFn | null = null;

export function setRendererInvoke(fn: RendererInvokeFn) {
  rendererInvoke = fn;
}

function stringifyResult(r: unknown): string {
  if (r === undefined || r === null) return 'ok';
  if (typeof r === 'string') return r;
  try {
    return JSON.stringify(r, null, 2);
  } catch {
    return String(r);
  }
}

async function runBlenderPython(code: string) {
  if (!code) {
    return { content: [{ type: 'text' as const, text: 'error: empty code' }], isError: true };
  }
  const res = await blenderConnection.send({
    type: 'execute_code',
    params: { code },
  });
  if (res.status === 'error') {
    return {
      content: [{ type: 'text' as const, text: `Blender error: ${res.message}` }],
      isError: true,
    };
  }
  return { content: [{ type: 'text' as const, text: stringifyResult(res.result) }] };
}

async function runBlenderSceneInfo() {
  const res = await blenderConnection.send({ type: 'get_scene_info' });
  if (res.status === 'error') {
    return {
      content: [{ type: 'text' as const, text: `Blender error: ${res.message}` }],
      isError: true,
    };
  }
  return { content: [{ type: 'text' as const, text: stringifyResult(res.result) }] };
}

async function invokeEngineTool(name: string, input: Record<string, unknown>) {
  if (!rendererInvoke) {
    return {
      content: [
        { type: 'text' as const, text: 'engine tools unavailable: renderer not registered' },
      ],
      isError: true,
    };
  }
  try {
    const result = await rendererInvoke(name, input);
    return { content: [{ type: 'text' as const, text: result }] };
  } catch (err) {
    return {
      content: [{ type: 'text' as const, text: (err as Error).message }],
      isError: true,
    };
  }
}

const hairyMcpServer = createSdkMcpServer({
  name: 'hairy',
  version: '0.0.3',
  alwaysLoad: true,
  tools: [
    tool(
      'blender_execute_python',
      'Execute Python in the connected Blender instance via the MCP socket (localhost:9876). bpy is pre-imported. stdout is captured. Use this to create or modify 3D content in Blender.',
      { code: z.string().describe('Python code to run in Blender.') },
      async ({ code }) => runBlenderPython(code),
    ),
    tool(
      'blender_get_scene_info',
      'List objects in the current Blender scene with names, types and transforms.',
      {},
      async () => runBlenderSceneInfo(),
    ),
    tool(
      'engine_add_primitive',
      "Add a primitive directly to the HairyEngine viewport (not Blender). Use to populate the engine's scene.",
      {
        type: z
          .enum(['cube', 'sphere', 'cylinder', 'plane', 'torus', 'point_light'])
          .describe('Primitive kind.'),
        name: z.string().optional().describe('Optional name for the new object.'),
        position: z
          .array(z.number())
          .length(3)
          .optional()
          .describe('Optional [x,y,z] world position.'),
        color: z
          .string()
          .optional()
          .describe('Optional CSS color like "#ff3a8c". Ignored for lights.'),
      },
      async (args) => invokeEngineTool('engine_add_primitive', args as Record<string, unknown>),
    ),
    tool(
      'engine_list_scene',
      'List top-level user-added objects in the HairyEngine scene.',
      {},
      async () => invokeEngineTool('engine_list_scene', {}),
    ),
    tool(
      'engine_attach_script',
      "Attach a built-in script (component) to a named object in the HairyEngine scene. Available scripts: Rotator, PlayerController, CharacterController, Rigidbody, AnimationPlayer, Crosshair, Shooter, ParticleEmitter, MainCamera, FollowCamera, AttachToBone.",
      {
        objectName: z
          .string()
          .describe('Name of the object to attach the script to (must exist in scene).'),
        scriptType: z
          .string()
          .describe('Script type, e.g. "Rotator" or "Shooter".'),
        params: z
          .record(z.string(), z.unknown())
          .optional()
          .describe('Optional script parameters keyed by param name.'),
      },
      async (args) => invokeEngineTool('engine_attach_script', args as Record<string, unknown>),
    ),
    tool(
      'engine_create_behavior',
      "Create a new custom behavior on a named object from a JavaScript snippet. Use this when the built-in scripts don't cover what the user wants. The code runs in Play Mode with these variables in scope: `owner` (the Object3D), `scene` (.three is the THREE.Scene), `input` (Input singleton with isKeyDown/isMouseDown/getMouseDelta), `camera` (the active camera), `THREE` (the namespace), and `dt` (seconds, passed each frame). Provide a body that runs every frame. Example body: \"owner.rotation.y += dt; if (input.isKeyDown('e')) (owner.material as any).color.set('#ff0000');\"",
      {
        objectName: z
          .string()
          .describe('Name of the object to attach the behavior to (must exist in scene).'),
        behaviorName: z
          .string()
          .describe('Short descriptive label for the behavior (e.g. "spin and shoot").'),
        body: z
          .string()
          .describe('JavaScript body. Runs every frame. `owner`, `scene`, `input`, `camera`, `THREE`, `dt` are in scope.'),
      },
      async (args) => invokeEngineTool('engine_create_behavior', args as Record<string, unknown>),
    ),
  ],
});

const ALLOWED_TOOLS = [
  'mcp__hairy__blender_execute_python',
  'mcp__hairy__blender_get_scene_info',
  'mcp__hairy__engine_add_primitive',
  'mcp__hairy__engine_list_scene',
  'mcp__hairy__engine_attach_script',
  'mcp__hairy__engine_create_behavior',
];

function conversationsDir() {
  return join(app.getPath('userData'), 'conversations');
}

async function ensureConversationsDir() {
  const dir = conversationsDir();
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function listConversations(): Promise<
  Array<{ id: string; title: string; updatedAt: number }>
> {
  const dir = await ensureConversationsDir();
  const names = await readdir(dir);
  const items: Array<{ id: string; title: string; updatedAt: number }> = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const raw = await readFile(join(dir, name), 'utf8');
      const conv = JSON.parse(raw) as Conversation;
      items.push({ id: conv.id, title: conv.title, updatedAt: conv.updatedAt });
    } catch {
      // skip malformed
    }
  }
  items.sort((a, b) => b.updatedAt - a.updatedAt);
  return items;
}

export async function loadConversation(id: string): Promise<Conversation | null> {
  const path = join(conversationsDir(), `${id}.json`);
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw) as Conversation;
  } catch {
    return null;
  }
}

export async function saveConversation(conv: Conversation): Promise<void> {
  await ensureConversationsDir();
  conv.updatedAt = Date.now();
  const path = join(conversationsDir(), `${conv.id}.json`);
  await writeFile(path, JSON.stringify(conv, null, 2), 'utf8');
}

export async function deleteConversation(id: string): Promise<void> {
  try {
    await unlink(join(conversationsDir(), `${id}.json`));
  } catch {
    // ignore
  }
}

export function newConversation(): Conversation {
  const now = Date.now();
  return {
    id: randomUUID(),
    title: 'New chat',
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

// Title derivation: first user message, truncated. Handles both string and
// structured content.
export function deriveTitle(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === 'user');
  if (!first) return 'New chat';
  let text = '';
  if (typeof first.content === 'string') {
    text = first.content;
  } else {
    const t = first.content.find((b): b is TextBlock => b.type === 'text');
    if (t) text = t.text;
  }
  text = text.trim().replace(/\s+/g, ' ');
  if (!text) return 'New chat';
  return text.length > 60 ? text.slice(0, 57) + '…' : text;
}

// Streams a Claude response through the Agent SDK. Returns the assembled
// blocks (text + tool turns) plus the session_id for resume on next send.
export async function streamMessage(
  userText: string,
  sessionId: string | undefined,
  broadcast: (event: StreamEvent) => void,
): Promise<{ blocks: ContentBlock[]; sessionId: string | undefined }> {
  const blocks: ContentBlock[] = [];
  let latestSessionId = sessionId;

  try {
    const q = query({
      prompt: userText,
      options: {
        systemPrompt: SYSTEM_PROMPT,
        mcpServers: { hairy: hairyMcpServer },
        allowedTools: ALLOWED_TOOLS,
        // We trust our own tools; no need to prompt the user for each call.
        permissionMode: 'bypassPermissions',
        includePartialMessages: true,
        resume: sessionId,
      },
    });

    for await (const event of q) {
      if (event.type === 'stream_event') {
        const raw = event.event as {
          type: string;
          delta?: { type: string; text?: string };
        };
        if (raw.type === 'content_block_delta' && raw.delta?.type === 'text_delta') {
          broadcast({ type: 'delta', text: raw.delta.text ?? '' });
        }
      } else if (event.type === 'assistant') {
        // Full assistant turn — record text + emit tool_call events.
        const msgContent = event.message.content as Array<
          | { type: 'text'; text: string }
          | { type: 'tool_use'; id: string; name: string; input: unknown }
        >;
        for (const block of msgContent) {
          if (block.type === 'text') {
            blocks.push({ type: 'text', text: block.text });
          } else if (block.type === 'tool_use') {
            const toolBlock: ToolUseBlock = {
              type: 'tool_use',
              id: block.id,
              name: stripMcpPrefix(block.name),
              input: (block.input as Record<string, unknown>) ?? {},
            };
            blocks.push(toolBlock);
            broadcast({
              type: 'tool_call',
              toolUseId: toolBlock.id,
              name: toolBlock.name,
              input: toolBlock.input,
            });
          }
        }
      } else if (event.type === 'user') {
        // Tool results come back to the SDK as a user message with tool_result blocks.
        const msgContent = event.message.content as
          | string
          | Array<{
              type: string;
              tool_use_id?: string;
              content?: unknown;
              is_error?: boolean;
            }>;
        if (Array.isArray(msgContent)) {
          for (const block of msgContent) {
            if (block.type === 'tool_result' && block.tool_use_id) {
              const content = normalizeToolResult(block.content);
              const result: ToolResultBlock = {
                type: 'tool_result',
                tool_use_id: block.tool_use_id,
                content,
                is_error: Boolean(block.is_error),
              };
              blocks.push(result);
              broadcast({
                type: 'tool_result',
                toolUseId: block.tool_use_id,
                content,
                is_error: Boolean(block.is_error),
              });
            }
          }
        }
      } else if (event.type === 'result') {
        latestSessionId = event.session_id;
        if (event.subtype !== 'success') {
          broadcast({
            type: 'error',
            message: `Stream ended with ${event.subtype}`,
          });
        }
      }
    }
  } catch (err) {
    broadcast({
      type: 'error',
      message: `Agent SDK error: ${(err as Error).message}`,
    });
    return { blocks, sessionId: latestSessionId };
  }

  broadcast({ type: 'done' });
  return { blocks, sessionId: latestSessionId };
}

function stripMcpPrefix(name: string): string {
  // SDK tool names come through as `mcp__hairy__blender_execute_python`.
  // Surface the short name to the UI.
  const idx = name.lastIndexOf('__');
  return idx >= 0 ? name.slice(idx + 2) : name;
}

function normalizeToolResult(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        const obj = c as { type?: string; text?: string };
        if (obj && obj.type === 'text' && typeof obj.text === 'string') return obj.text;
        try {
          return JSON.stringify(c);
        } catch {
          return String(c);
        }
      })
      .join('\n');
  }
  try {
    return JSON.stringify(content, null, 2);
  } catch {
    return String(content);
  }
}

export function broadcastToAll(channel: string, payload: unknown) {
  for (const wc of webContents.getAllWebContents()) {
    if (!wc.isDestroyed()) wc.send(channel, payload);
  }
}

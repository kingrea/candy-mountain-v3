import { resolve } from 'node:path';
import type { ContentBlock, SessionUpdate, ToolKind, ToolCallContent } from '@agentclientprotocol/sdk';
import type { ClaudeEvent } from './process';

export function convertPrompt(prompt: ContentBlock[]): unknown[] {
  return prompt.map(block => {
    if (block.type === 'text') return { type: 'text', text: block.text };
    if (block.type === 'image') {
      if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(block.mimeType)) throw new Error(`Unsupported Claude image MIME type: ${block.mimeType}`);
      if (!block.data || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(block.data)) throw new Error('Image requires valid base64 data');
      return { type: 'image', source: { type: 'base64', media_type: block.mimeType, data: block.data } };
    }
    throw new Error(`Unsupported Claude prompt content: ${block.type}`);
  });
}

type Block = { type: string; id?: string; partial: string };
type Message = { id: string; blocks: Map<number, Block>; streamedText: Set<number> };
type Tool = { name: string; input: unknown; complete: boolean };
const kinds: Record<string, ToolKind> = { Bash: 'execute', Read: 'read', Write: 'edit', Edit: 'edit', MultiEdit: 'edit', NotebookEdit: 'edit', Glob: 'search', Grep: 'search', WebFetch: 'fetch', WebSearch: 'search', Agent: 'think', Task: 'think' };

/** Shared by the translator and the permission bridge so a decision reads like the tool call it gates. */
export function describeToolCall(name: string, input: any, cwd: string) {
  const path = typeof input?.file_path === 'string' ? input.file_path : typeof input?.notebook_path === 'string' ? input.notebook_path : undefined;
  const suffix = typeof input?.command === 'string' ? input.command : path ?? (typeof input?.pattern === 'string' ? input.pattern : undefined);
  return { title: suffix ? `${name}: ${suffix}` : name, kind: kinds[name] ?? 'other' as ToolKind, locations: path ? [{ path: resolve(cwd, path) }] : [] };
}

/** Stateful per-session translator. No Anthropic transport or UI dependencies. */
export class ClaudeEventTranslator {
  private active = new Map<string, Message>();
  private messages = new Map<string, Message>();
  private tools = new Map<string, Tool>();
  private finalMessages = new Set<string>();
  private hasText = false;
  constructor(private emit: (update: SessionUpdate) => Promise<void> | void, private cwd: string) {}
  beginTurn() { this.active.clear(); this.messages.clear(); this.tools.clear(); this.finalMessages.clear(); this.hasText = false; }
  private text(text: string) {
    if (!text) return;
    this.hasText = true;
    return this.emit({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } });
  }
  private details(name: string, input: any) { return describeToolCall(name, input, this.cwd); }
  private async tool(id: string, name: string, input: unknown, parent?: string | null) {
    if (!id || !name) throw new Error('Malformed Claude tool start');
    const existing = this.tools.get(id);
    this.tools.set(id, { name, input, complete: existing?.complete ?? false });
    if (!existing) await this.emit({ sessionUpdate: 'tool_call', toolCallId: id, ...this.details(name, input), status: 'in_progress', rawInput: input, ...(parent ? { _meta: { parentToolCallId: parent } } : {}) });
    else if (!existing.complete) await this.emit({ sessionUpdate: 'tool_call_update', toolCallId: id, ...this.details(name, input), rawInput: input });
  }
  private async result(block: any, parent?: string | null) {
    if (typeof block.tool_use_id !== 'string') throw new Error('Malformed Claude tool result');
    if (!this.tools.has(block.tool_use_id)) await this.tool(block.tool_use_id, 'Tool (start unavailable)', undefined, parent);
    const tool = this.tools.get(block.tool_use_id)!;
    if (tool.complete) return;
    tool.complete = true;
    const content: ToolCallContent[] = [];
    if (typeof block.content === 'string') content.push({ type: 'content', content: { type: 'text', text: block.content } });
    else if (Array.isArray(block.content)) for (const item of block.content) {
      if (item.type === 'text' && typeof item.text === 'string') content.push({ type: 'content', content: { type: 'text', text: item.text } });
      else if (item.type === 'image' && item.source?.type === 'base64') content.push({ type: 'content', content: { type: 'image', data: item.source.data, mimeType: item.source.media_type } });
    }
    await this.emit({ sessionUpdate: 'tool_call_update', toolCallId: block.tool_use_id, status: block.is_error ? 'failed' : 'completed', rawInput: tool.input, rawOutput: block.content, content });
  }
  async accept(envelope: ClaudeEvent): Promise<void> {
    const parent = envelope.parent_tool_use_id ?? '';
    if (envelope.type === 'stream_event') {
      const event = envelope.event;
      if (!event || typeof event.type !== 'string') throw new Error('Malformed Claude stream event');
      if (event.type === 'message_start') {
        if (typeof event.message?.id !== 'string') throw new Error('Claude message start is missing identity');
        const message: Message = { id: event.message.id, blocks: new Map(), streamedText: new Set() };
        this.active.set(parent, message); this.messages.set(message.id, message);
      } else if (event.type === 'content_block_start') {
        const message = this.active.get(parent);
        if (!message) throw new Error('Claude content arrived before message start');
        const block = event.content_block;
        if (!block || typeof block.type !== 'string') throw new Error('Malformed Claude content block');
        message.blocks.set(event.index, { type: block.type, id: block.id, partial: '' });
        if (block.type === 'tool_use') await this.tool(block.id, block.name, block.input ?? {}, parent);
        if (block.type === 'text' && block.text) { message.streamedText.add(event.index); await this.text(block.text); }
      } else if (event.type === 'content_block_delta') {
        const message = this.active.get(parent); const block = message?.blocks.get(event.index);
        if (!message || !block) throw new Error('Claude delta arrived before content block start');
        if (event.delta?.type === 'text_delta') {
          if (typeof event.delta.text !== 'string') throw new Error('Malformed Claude text delta');
          message.streamedText.add(event.index); await this.text(event.delta.text);
        } else if (event.delta?.type === 'input_json_delta') {
          if (block.type !== 'tool_use' || typeof event.delta.partial_json !== 'string') throw new Error('Malformed Claude tool input delta');
          block.partial += event.delta.partial_json;
        }
      } else if (event.type === 'content_block_stop') {
        const block = this.active.get(parent)?.blocks.get(event.index);
        if (block?.id && block.partial) {
          let input: unknown; try { input = JSON.parse(block.partial); } catch { throw new Error('Malformed Claude streamed tool input'); }
          await this.tool(block.id, this.tools.get(block.id)!.name, input, parent);
        }
      }
      return;
    }
    if (envelope.type === 'assistant') {
      const message = envelope.message;
      if (!message || !Array.isArray(message.content)) throw new Error('Malformed Claude assistant message');
      if (message.id && this.finalMessages.has(message.id)) return;
      if (message.id) this.finalMessages.add(message.id);
      const streamed = this.messages.get(message.id);
      for (const [index, block] of message.content.entries()) {
        if (block.type === 'text' && typeof block.text === 'string' && !streamed?.streamedText.has(index)) await this.text(block.text);
        else if (block.type === 'tool_use') await this.tool(block.id, block.name, block.input, parent);
      }
    } else if (envelope.type === 'user' && Array.isArray(envelope.message?.content)) {
      for (const block of envelope.message.content) if (block.type === 'tool_result') await this.result(block, parent);
    } else if (envelope.type === 'result' && envelope.subtype === 'success' && !envelope.is_error && !envelope.cancelled && !this.hasText && typeof envelope.result === 'string') {
      // Some stock versions emit only a result for an otherwise successful text turn.
      await this.text(envelope.result);
    }
    // Metadata and future event types carry no completion semantics.
  }
}

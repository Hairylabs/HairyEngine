// In-engine Claude chat.
// Sidebar of saved conversations + active chat with streaming responses.
// API key is stored encrypted in the OS keychain via the main process.

type TextBlock = { type: 'text'; text: string };
type ToolUseBlock = {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
};
type ToolResultBlock = {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};
type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
  timestamp: number;
};

type Conversation = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  model?: string;
};

export class ClaudePanel {
  private rootEl: HTMLElement;
  private convs: Array<{ id: string; title: string; updatedAt: number }> = [];
  private active: Conversation | null = null;
  private streamingMessageEl: HTMLElement | null = null;
  private streamingText = '';
  private currentRequestId: string | null = null;
  private hasKey = false;

  constructor(parent: HTMLElement) {
    this.rootEl = parent;
    parent.classList.add('claude-panel');
    parent.innerHTML = `
      <div class="claude-sidebar">
        <button class="claude-new" id="claude-new">+ New chat</button>
        <div class="claude-conversations" id="claude-conversations"></div>
        <div class="claude-footer">
          <button class="claude-settings-btn" id="claude-settings">⚙ Settings</button>
        </div>
      </div>
      <div class="claude-main">
        <div class="claude-messages" id="claude-messages"></div>
        <div class="claude-composer">
          <textarea id="claude-input" rows="3" placeholder="Ask Claude — Enter to send, Shift+Enter for newline"></textarea>
          <button class="claude-send-btn" id="claude-send">Send</button>
        </div>
      </div>
    `;

    parent.querySelector('#claude-new')?.addEventListener('click', () => this.newConversation());
    parent.querySelector('#claude-settings')?.addEventListener('click', () => this.showSettings());
    parent.querySelector('#claude-send')?.addEventListener('click', () => this.sendMessage());
    const inputEl = parent.querySelector('#claude-input') as HTMLTextAreaElement;
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    window.hairy.ai.onStream((evt) => this.onStreamEvent(evt));

    this.init();
  }

  private async init() {
    this.hasKey = await window.hairy.ai.hasKey();
    await this.refreshConversations();
    if (this.convs.length > 0) {
      await this.loadConversation(this.convs[0].id);
    } else {
      await this.newConversation();
    }
    this.renderMessages();
  }

  private async refreshConversations() {
    this.convs = await window.hairy.ai.listConversations();
    this.renderSidebar();
  }

  private renderSidebar() {
    const list = this.rootEl.querySelector('#claude-conversations') as HTMLElement;
    list.innerHTML = '';
    if (this.convs.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No saved chats yet.';
      list.appendChild(empty);
      return;
    }
    for (const c of this.convs) {
      const row = document.createElement('div');
      row.className = 'claude-conv-row';
      if (this.active?.id === c.id) row.classList.add('active');
      row.title = c.title;
      const label = document.createElement('div');
      label.className = 'claude-conv-title';
      label.textContent = c.title;
      const del = document.createElement('button');
      del.className = 'claude-conv-delete';
      del.textContent = '×';
      del.title = 'Delete';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        this.deleteConversation(c.id);
      });
      row.appendChild(label);
      row.appendChild(del);
      row.addEventListener('click', () => this.loadConversation(c.id));
      list.appendChild(row);
    }
  }

  private async newConversation() {
    this.active = await window.hairy.ai.newConversation();
    this.renderSidebar();
    this.renderMessages();
  }

  private async loadConversation(id: string) {
    const conv = await window.hairy.ai.loadConversation(id);
    if (!conv) return;
    this.active = conv;
    this.renderSidebar();
    this.renderMessages();
  }

  private async deleteConversation(id: string) {
    if (!confirm('Delete this chat?')) return;
    await window.hairy.ai.deleteConversation(id);
    if (this.active?.id === id) this.active = null;
    await this.refreshConversations();
    if (this.convs.length === 0) await this.newConversation();
    else if (!this.active) await this.loadConversation(this.convs[0].id);
  }

  private renderMessages() {
    const messages = this.rootEl.querySelector('#claude-messages') as HTMLElement;
    messages.innerHTML = '';
    if (!this.active || this.active.messages.length === 0) {
      const intro = document.createElement('div');
      intro.className = 'claude-intro';
      intro.innerHTML = `
        <div class="claude-intro-head">Ask Claude anything about your game.</div>
        <div class="claude-intro-sub">Uses your Claude Code subscription via CLI — no API tokens billed.<br>Try: "make a tree in Blender" or "add a red cube to the engine at [0, 1, 0]".</div>`;
      messages.appendChild(intro);
      return;
    }
    for (const msg of this.active.messages) {
      messages.appendChild(this.renderMessage(msg));
    }
    messages.scrollTop = messages.scrollHeight;
  }

  private renderMessage(msg: ChatMessage): HTMLElement {
    const row = document.createElement('div');
    row.className = `claude-msg claude-msg-${msg.role}`;
    const head = document.createElement('div');
    head.className = 'claude-msg-head';
    head.textContent = msg.role === 'user' ? 'You' : 'Claude';
    const body = document.createElement('div');
    body.className = 'claude-msg-body';
    if (typeof msg.content === 'string') {
      body.innerHTML = renderMarkdown(msg.content);
    } else {
      this.renderBlocks(body, msg.content);
    }
    row.appendChild(head);
    row.appendChild(body);
    return row;
  }

  private renderBlocks(parent: HTMLElement, blocks: ContentBlock[]) {
    for (const b of blocks) {
      if (b.type === 'text') {
        const div = document.createElement('div');
        div.innerHTML = renderMarkdown(b.text);
        parent.appendChild(div);
      } else if (b.type === 'tool_use') {
        parent.appendChild(this.renderToolCall(b));
      } else if (b.type === 'tool_result') {
        parent.appendChild(this.renderToolResult(b));
      }
    }
  }

  private renderToolCall(t: ToolUseBlock): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'claude-tool';
    wrap.dataset.toolId = t.id;
    wrap.innerHTML = `
      <div class="claude-tool-head">
        <span class="claude-tool-icon">⚙</span>
        <span class="claude-tool-name">${escapeHtml(t.name)}</span>
        <span class="claude-tool-state">running…</span>
      </div>
      <pre class="claude-tool-input">${escapeHtml(safeJson(t.input))}</pre>
    `;
    return wrap;
  }

  private renderToolResult(t: ToolResultBlock): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = `claude-tool-result${t.is_error ? ' is-error' : ''}`;
    wrap.dataset.toolResultId = t.tool_use_id;
    wrap.innerHTML = `
      <div class="claude-tool-result-head">${t.is_error ? '⨯ Error' : '✓ Result'}</div>
      <pre class="claude-tool-result-body">${escapeHtml(t.content)}</pre>
    `;
    return wrap;
  }

  private async sendMessage() {
    if (!this.active) return;
    const input = this.rootEl.querySelector('#claude-input') as HTMLTextAreaElement;
    const text = input.value.trim();
    if (!text || this.currentRequestId) return;
    // No API-key gating; the Agent SDK uses the user's Claude Code subscription.

    input.value = '';

    // Locally optimistic: append user message immediately
    const userMsg: ChatMessage = { role: 'user', content: text, timestamp: Date.now() };
    this.active.messages.push(userMsg);
    const messagesEl = this.rootEl.querySelector('#claude-messages') as HTMLElement;
    messagesEl.querySelector('.claude-intro')?.remove();
    messagesEl.appendChild(this.renderMessage(userMsg));

    // Stub assistant message that will grow as the stream arrives
    const placeholderMsg: ChatMessage = { role: 'assistant', content: '', timestamp: Date.now() };
    const placeholder = this.renderMessage(placeholderMsg);
    placeholder.classList.add('is-streaming');
    messagesEl.appendChild(placeholder);
    this.streamingMessageEl = placeholder.querySelector('.claude-msg-body');
    this.streamingText = '';
    messagesEl.scrollTop = messagesEl.scrollHeight;

    this.currentRequestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await window.hairy.ai.send(this.currentRequestId, this.active.id, text);
  }

  private onStreamEvent(evt: { requestId: string; type: string } & Record<string, unknown>) {
    if (evt.requestId !== this.currentRequestId) return;
    const messagesEl = this.rootEl.querySelector('#claude-messages') as HTMLElement;
    if (evt.type === 'delta' && this.streamingMessageEl) {
      this.streamingText += (evt.text as string) ?? '';
      // Re-render the streaming text block. Tool blocks rendered earlier in
      // this turn live as siblings; we wrap text into its own div so they
      // don't clobber each other.
      let textBlock = this.streamingMessageEl.querySelector('.claude-current-text') as HTMLElement | null;
      if (!textBlock) {
        textBlock = document.createElement('div');
        textBlock.className = 'claude-current-text';
        this.streamingMessageEl.appendChild(textBlock);
      }
      textBlock.innerHTML = renderMarkdown(this.streamingText);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    } else if (evt.type === 'tool_call' && this.streamingMessageEl) {
      // Persist what we already streamed as a stable text block, then mount the tool card
      this.lockInStreamedText();
      const block: ToolUseBlock = {
        type: 'tool_use',
        id: evt.toolUseId as string,
        name: evt.name as string,
        input: (evt.input as Record<string, unknown>) ?? {},
      };
      this.streamingMessageEl.appendChild(this.renderToolCall(block));
      messagesEl.scrollTop = messagesEl.scrollHeight;
    } else if (evt.type === 'tool_result' && this.streamingMessageEl) {
      // Mark the matching tool card as complete and append the result.
      const id = evt.toolUseId as string;
      const card = this.streamingMessageEl.querySelector(
        `.claude-tool[data-tool-id="${CSS.escape(id)}"]`,
      ) as HTMLElement | null;
      if (card) {
        const state = card.querySelector('.claude-tool-state');
        if (state) state.textContent = evt.is_error ? 'failed' : 'done';
        if (evt.is_error) card.classList.add('is-error');
      }
      const block: ToolResultBlock = {
        type: 'tool_result',
        tool_use_id: id,
        content: String(evt.content ?? ''),
        is_error: Boolean(evt.is_error),
      };
      this.streamingMessageEl.appendChild(this.renderToolResult(block));
      messagesEl.scrollTop = messagesEl.scrollHeight;
    } else if (evt.type === 'error') {
      if (this.streamingMessageEl) {
        const err = document.createElement('div');
        err.className = 'claude-error';
        err.textContent = String(evt.message ?? 'Error');
        this.streamingMessageEl.appendChild(err);
      }
      this.streamingMessageEl?.parentElement?.classList.remove('is-streaming');
      this.streamingMessageEl = null;
      this.currentRequestId = null;
    } else if (evt.type === 'done') {
      this.streamingMessageEl?.parentElement?.classList.remove('is-streaming');
      this.streamingMessageEl = null;
      this.streamingText = '';
      this.currentRequestId = null;
    } else if (evt.type === 'persisted') {
      const conv = evt.conversation as Conversation;
      if (this.active && conv && conv.id === this.active.id) {
        this.active = conv;
        // Re-render to adopt the server-grouped block structure.
        this.renderMessages();
      }
      this.refreshConversations();
    }
  }

  private lockInStreamedText() {
    if (!this.streamingMessageEl) return;
    const cur = this.streamingMessageEl.querySelector('.claude-current-text') as HTMLElement | null;
    if (!cur) return;
    cur.classList.remove('claude-current-text');
    this.streamingText = '';
  }

  private showSettings() {
    const dialog = document.createElement('div');
    dialog.className = 'claude-modal-backdrop';
    dialog.innerHTML = `
      <div class="claude-modal">
        <div class="claude-modal-head">Claude settings</div>
        <div class="claude-modal-body">
          <div class="claude-modal-sub">
            HairyEngine's chat uses your <strong>Claude Code subscription</strong> via the official Agent SDK.
            No API tokens are billed — your messages count against your normal Claude Code quota.<br><br>
            Requires the <code>claude</code> CLI to be installed and authenticated (you're already set up if you can run <code>claude</code> from a terminal).
          </div>
        </div>
        <div class="claude-modal-actions">
          <button class="claude-btn primary" id="api-cancel">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(dialog);
    dialog.querySelector('#api-cancel')?.addEventListener('click', () => dialog.remove());
  }
}

// Minimal markdown: paragraphs, **bold**, *italic*, `inline code`, ```fenced```,
// hard-coded enough for chat readability without dragging in a parser.
function renderMarkdown(text: string): string {
  // Code fences first (so other rules don't touch their content)
  const fences: string[] = [];
  let prepared = text.replace(/```([\s\S]*?)```/g, (_m, body) => {
    fences.push(body);
    return ` FENCE${fences.length - 1} `;
  });
  prepared = escapeHtml(prepared);
  prepared = prepared.replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`);
  prepared = prepared.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  prepared = prepared.replace(/(^|[^*])\*([^*]+)\*([^*]|$)/g, '$1<em>$2</em>$3');
  prepared = prepared.replace(/\n\n/g, '</p><p>');
  prepared = prepared.replace(/\n/g, '<br>');
  prepared = `<p>${prepared}</p>`;
  prepared = prepared.replace(/ FENCE(\d+) /g, (_m, idx) => {
    const body = fences[Number(idx)] ?? '';
    return `<pre><code>${escapeHtml(body)}</code></pre>`;
  });
  return prepared;
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}

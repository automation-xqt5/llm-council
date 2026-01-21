/**
 * API client for the LLM Council backend with PDF support.
 * Optimized for Coolify deployment with subdomains.
 */

// Use VITE_API_URL from environment variables (configured in Coolify/Docker)
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8001';

let authToken = null;

export const api = {
  /**
   * Set authentication token for subsequent requests
   */
  setToken(token) {
    authToken = token;
  },

  /**
   * Get authentication headers. 
   * @param {boolean} isJson - If true, adds Content-Type: application/json
   */
  getAuthHeaders(isJson = true) {
    const headers = {};
    if (isJson) {
      headers['Content-Type'] = 'application/json';
    }
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }
    return headers;
  },

  /**
   * Register a new user
   */
  async register(username, email, password) {
    try {
      const response = await fetch(`${API_BASE}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Failed to register' }));
        throw new Error(error.detail || `Server error: ${response.status}`);
      }
      return response.json();
    } catch (error) {
      throw new Error(error.message || "Connection failed");
    }
  },

  /**
   * Login and receive token
   */
  async login(username, password) {
    try {
      const response = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Failed to login' }));
        throw new Error(error.detail || `Server error: ${response.status}`);
      }
      return response.json();
    } catch (error) {
      throw new Error(error.message || "Connection failed");
    }
  },

  /**
   * Get current user profile
   */
  async getCurrentUser() {
    const response = await fetch(`${API_BASE}/api/auth/me`, {
      headers: this.getAuthHeaders(),
    });
    if (!response.ok) throw new Error('Failed to fetch user info');
    return response.json();
  },

  /**
   * List all conversations for the user
   */
  async listConversations() {
    const response = await fetch(`${API_BASE}/api/conversations`, {
      headers: this.getAuthHeaders(),
    });
    if (!response.ok) throw new Error('Failed to fetch conversations');
    return response.json();
  },

  /**
   * Create a new conversation session
   */
  async createConversation() {
    const response = await fetch(`${API_BASE}/api/conversations`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({}),
    });
    if (!response.ok) throw new Error('Failed to create conversation');
    return response.json();
  },

  /**
   * Get messages and metadata for a specific conversation
   */
  async getConversation(conversationId) {
    const response = await fetch(`${API_BASE}/api/conversations/${conversationId}`, {
      headers: this.getAuthHeaders(),
    });
    if (!response.ok) {
      const error = new Error(`Conversation not found (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  },

  /**
   * Delete a conversation
   */
  async deleteConversation(conversationId) {
    const response = await fetch(`${API_BASE}/api/conversations/${conversationId}`, {
      method: 'DELETE',
      headers: this.getAuthHeaders(),
    });
    if (!response.ok) throw new Error('Failed to delete conversation');
    return response.json();
  },

  /**
   * Send a message. If pdfData is provided, the backend will trigger the OCR flow.
   */
  async sendMessage(conversationId, content, pdfData = null, pdfFilename = null) {
    const response = await fetch(`${API_BASE}/api/conversations/${conversationId}/message`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({
        content,
        pdf_data: pdfData,
        pdf_filename: pdfFilename,
      }),
    });
    if (!response.ok) throw new Error('Failed to send message');
    return response.json();
  },

  /**
   * Send a message with Server-Sent Events (SSE) streaming
   */
  async sendMessageStream(conversationId, content, onStage1, onStage2, onStage3, onTitleUpdate, pdfData = null, pdfFilename = null) {
    const response = await fetch(`${API_BASE}/api/conversations/${conversationId}/message/stream`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({
        content,
        pdf_data: pdfData,
        pdf_filename: pdfFilename,
      }),
    });

    if (!response.ok) throw new Error('Failed to initiate stream');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') return;

          try {
            const parsed = JSON.parse(data);
            switch (parsed.type) {
              case 'stage1_complete': onStage1?.(parsed.data); break;
              case 'stage2_complete': onStage2?.(parsed.data, parsed.metadata); break;
              case 'stage3_complete': onStage3?.(parsed.data); break;
              case 'title_complete': onTitleUpdate?.(parsed.data?.title); break;
              case 'error': throw new Error(parsed.message || 'Stream error');
            }
          } catch (e) {
            console.error('SSE Parse Error:', e);
          }
        }
      }
    }
  },

  /**
   * Uploads a PDF file to get its base64 representation.
   * Note: The backend will then use this base64 to perform Mistral OCR.
   */
  async uploadPdf(file) {
    const formData = new FormData();
    formData.append('file', file);

    // Important: Do not set Content-Type header when sending FormData, 
    // the browser will set it automatically with the correct boundary.
    const response = await fetch(`${API_BASE}/api/upload-pdf`, {
      method: 'POST',
      headers: this.getAuthHeaders(false), 
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to upload PDF');
    }

    return response.json(); // Returns { pdf_data: "base64...", filename: "..." }
  },
};

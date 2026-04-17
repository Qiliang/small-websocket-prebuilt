# SmallWebSocket Prebuilt

A simple, ready-to-use client for testing the **WebSocketTransport** with [Pipecat](https://github.com/pipecat-ai/pipecat).

This prebuilt client provides basic WebSocket voice AI functionality and serves as a lightweight tool
to quickly verify transport behavior without needing a custom implementation.

Ideal for development, debugging, and quick prototyping.

---

## 📦 Installation & Usage

If you just want to **use** the prebuilt WebSocket client in your own Python project:

### ✅ Install from PyPI

```bash
pip install small-websocket-prebuilt
```

### 🧰 Example Usage

```python
from fastapi import FastAPI
from fastapi.responses import RedirectResponse
from small_websocket_prebuilt.frontend import SmallWebSocketPrebuiltUI

app = FastAPI()

# Mount the frontend at /prebuilt
app.mount("/prebuilt", SmallWebSocketPrebuiltUI)

@app.get("/", include_in_schema=False)
async def root_redirect():
    return RedirectResponse(url="/prebuilt/")
```

## ⌨ Development Quick Start

If you want to work on the prebuilt client itself or use it locally in development:

#### 📋 Prerequisites

- [Node.js](https://nodejs.org/) (for building the client)
- [uv](https://docs.astral.sh/uv/) (recommended for Python dependency management)


## 🔗 WebSocket Transport

The client uses [`@pipecat-ai/websocket-transport`](https://github.com/pipecat-ai/pipecat-client-web-transports/tree/main/transports/websocket-transport) to connect to your Pipecat bot.

You can connect either:
- **Directly** using a WebSocket URL: `ws://localhost:7860/ws`
- **Via endpoint**: provide an HTTP URL that returns the WebSocket connection info

import asyncio
import json
import logging
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core import config

logger = logging.getLogger("uvicorn.error")

router = APIRouter(tags=["WebSockets"])

_SEND_TIMEOUT_S = 2.0


class TreeEventConnectionManager:
    def __init__(self) -> None:
        self.active_connections: set[WebSocket] = set()
        self._tasks: set[asyncio.Task] = set()

    async def connect(self, websocket: WebSocket) -> bool:
        if len(self.active_connections) >= config.WS_MAX_CONNECTIONS:
            # Без живых событий Ёлка работает, просто без полёта совы.
            await websocket.close(code=1013)  # Try Again Later
            return False
        await websocket.accept()
        self.active_connections.add(websocket)
        return True

    def disconnect(self, websocket: WebSocket) -> None:
        self.active_connections.discard(websocket)

    async def _send(self, connection: WebSocket, message: str) -> WebSocket | None:
        try:
            await asyncio.wait_for(connection.send_text(message), timeout=_SEND_TIMEOUT_S)
            return None
        except Exception:
            return connection

    async def broadcast_event(self, event_type: str, payload: dict[str, Any]) -> None:
        message = json.dumps({"event": event_type, "data": payload}, default=str, ensure_ascii=False)
        connections = list(self.active_connections)
        # Параллельно и с таймаутом: один «зависший» клиент не тормозит остальных.
        results = await asyncio.gather(*(self._send(c, message) for c in connections))
        for dead in results:
            if dead is not None:
                self.disconnect(dead)

    def schedule_broadcast(self, event_type: str, payload: dict[str, Any]) -> None:
        task = asyncio.create_task(self.broadcast_event(event_type, payload))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)


ws_manager = TreeEventConnectionManager()


@router.websocket("/ws/tree-events")
async def tree_events_websocket(websocket: WebSocket):
    if not await ws_manager.connect(websocket):
        return
    try:
        while True:
            raw = await websocket.receive_text()
            if raw == "ping":
                await websocket.send_text('{"event": "PONG"}')
            # Остальные входящие сообщения игнорируются: канал только на чтение.
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.debug("[WS] соединение закрыто с ошибкой", exc_info=True)
    finally:
        ws_manager.disconnect(websocket)

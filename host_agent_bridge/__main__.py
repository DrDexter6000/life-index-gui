"""Run the optional host-agent reference bridge."""

import uvicorn

from host_agent_bridge.server import app


def main() -> None:
    uvicorn.run(app, host="127.0.0.1", port=8791)


if __name__ == "__main__":
    main()


# Command JSON Adapter

This provider-neutral adapter wraps a user-configured headless-agent command in
the Life Index GUI `stdio-json` runtime contract.

It does not ship a model, SDK, API key, provider default, or agent runtime. The
only command it runs is the one you configure.

## Contract

The reference bridge passes a prompt containing `Request JSON:` to this adapter.
The adapter extracts that request object and invokes your command with the pure
request JSON.

By default, the request JSON is sent to the command on stdin:

```bash
export LIFE_INDEX_HOST_AGENT_ARGV_JSON='["python","examples/host-agent-runtime/command-json-adapter/command_json_adapter.py"]'
export LIFE_INDEX_HOST_AGENT_ADAPTER_ARGV_JSON='["/path/to/your/headless-agent-json-command"]'
python -m uvicorn host_agent_bridge.server:app --host 127.0.0.1 --port 8791
```

If your command expects the request as an argument, use `{request_json}`:

```bash
export LIFE_INDEX_HOST_AGENT_ADAPTER_ARGV_JSON='["/path/to/your/headless-agent-json-command","--request","{request_json}"]'
```

Your command must print exactly one public handoff envelope:

- `gui.host_agent.query_response.v1` for query requests.
- `gui.host_agent.metadata_proposal.v1` for metadata requests.

If the command is missing, times out, fails, or returns invalid JSON, the adapter
returns an honest `UNAVAILABLE` envelope. It does not fabricate an answer or
metadata proposal.

## Configuration

| Variable | Meaning |
| --- | --- |
| `LIFE_INDEX_HOST_AGENT_ADAPTER_ARGV_JSON` | JSON array command form. Preferred because it avoids shell quoting. |
| `LIFE_INDEX_HOST_AGENT_ADAPTER_COMMAND` | Shell-style command string fallback. |
| `LIFE_INDEX_HOST_AGENT_ADAPTER_CWD` | Optional working directory for the command. |
| `LIFE_INDEX_HOST_AGENT_ADAPTER_TIMEOUT_SECONDS` | Optional timeout. Defaults to 600 seconds. |

Use the conformance kit before pointing the GUI at the bridge:

```bash
python -m host_agent_bridge.conformance --base-url http://127.0.0.1:8791 --expect ready
```

During setup, `--expect runtime-unavailable` verifies that the bridge is
reachable while the configured external command still fails closed.

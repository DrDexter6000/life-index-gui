#!/usr/bin/env node
import { applyGuiUpgrade, planGuiUpgrade, GUI_UPGRADE_COMMAND, GUI_UPGRADE_SCHEMA_VERSION } from './lib/gui-upgrade-atom.mjs';

function parseArgs(argv) {
  const mode = argv.includes('--apply') ? 'apply' : 'plan';
  const hasPlan = argv.includes('--plan');
  const hasApply = argv.includes('--apply');
  const json = argv.includes('--json');

  if (hasPlan && hasApply) {
    return { ok: false, code: 'GUI_UPGRADE_INVALID_ARGS', message: 'Use either --plan or --apply, not both.' };
  }
  if (!hasPlan && !hasApply) {
    return { ok: false, code: 'GUI_UPGRADE_INVALID_ARGS', message: 'Use --plan --json or --apply --json.' };
  }
  if (!json) {
    return { ok: false, code: 'GUI_UPGRADE_JSON_REQUIRED', message: 'GUI upgrade requires --json so stdout remains machine-parseable.' };
  }

  return { ok: true, mode };
}

function errorEnvelope({ code, message, mode = 'plan' }) {
  return {
    success: false,
    schema_version: GUI_UPGRADE_SCHEMA_VERSION,
    command: GUI_UPGRADE_COMMAND,
    mode,
    data: {
      repo: null,
      node: null,
      python: null,
      cli_dependency: null,
      actions: [],
      recommended_next_step: {
        id: 'none',
        description: 'No action was planned because argument validation failed.',
        command: null,
        side_effect: 'read',
        safe_to_run: true,
        requires_human: false,
      },
      reinstall_required: false,
      reinstall_playbook: 'docs/AGENT_UPDATE_PLAYBOOK.md',
      partial: true,
    },
    error: { code, message },
  };
}

const parsed = parseArgs(process.argv.slice(2));
const envelope = parsed.ok
  ? (parsed.mode === 'apply' ? applyGuiUpgrade() : planGuiUpgrade())
  : errorEnvelope({ code: parsed.code, message: parsed.message });

process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
process.exitCode = envelope.success ? 0 : 1;

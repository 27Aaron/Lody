import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { __test__ } from './index';

describe('cli tool detection helpers', () => {
  it('selectWindowsWhereCandidate prefers .cmd over .ps1', () => {
    const picked = __test__.selectWindowsWhereCandidate([
      'C:\\Users\\Z\\AppData\\Local\\fnm_multishells\\x\\codex.ps1',
      'C:\\Users\\Z\\AppData\\Local\\fnm_multishells\\x\\codex.cmd',
    ]);
    expect(picked).toMatch(/codex\.cmd$/i);
  });

  it('builds the Claude config file path under the provided home directory', () => {
    expect(__test__.getClaudeConfigPath('/tmp/home')).toBe(path.join('/tmp/home', '.claude.json'));
  });

  it('builds the Claude home directory path under the provided home directory', () => {
    expect(__test__.getClaudeHomeDir('/tmp/home')).toBe(path.join('/tmp/home', '.claude'));
  });

  it('builds the Codex auth file path under the provided home directory', () => {
    const originalCodexHome = process.env.CODEX_HOME;
    delete process.env.CODEX_HOME;
    try {
      expect(__test__.getCodexCredentialsPath('/tmp/home')).toBe(
        path.join('/tmp/home', '.codex', 'auth.json')
      );
    } finally {
      if (originalCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = originalCodexHome;
      }
    }
  });

  it('honors CODEX_HOME when computing the Codex auth path', () => {
    const originalCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = '/tmp/custom-codex';
    try {
      expect(__test__.getCodexCredentialsPath('/tmp/home')).toBe(
        path.join('/tmp/custom-codex', 'auth.json')
      );
    } finally {
      if (originalCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = originalCodexHome;
      }
    }
  });
});

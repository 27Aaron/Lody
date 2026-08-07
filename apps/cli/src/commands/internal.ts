import { Command } from 'commander';
import { runLodyMcpServer } from '@/mcp/lody-mcp-server';

export const internalCommand = new Command('__internal')
  .description('(internal) Lody helper commands')
  .addCommand(
    new Command('lody-mcp-server')
      .description('(internal) stdio MCP server for Lody session tools')
      .action(async () => {
        await runLodyMcpServer();
      })
  );

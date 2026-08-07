import type { Meta, StoryObj } from '@storybook/react';
import type { ProjectSkillGroup } from '@lody/shared';
import { Mention, MentionInput } from '@/ui/mention';
import {
  SkillMentionMenu,
  buildSkillMentionItems,
} from '@/components/mentions/mention-skill-source';
import { useProjectSkills } from '@/hooks/use-project-skills';

/* The `$` skill mention menu only renders inside a <Mention> root (it reads the
   mention context). The harness mounts a forced-open root anchored to a small
   textarea so the desktop two-pane popover (compact name list + hover/keyboard
   detail panel) is screenshot-verifiable without a live composer + project. */

const GROUPS: ProjectSkillGroup[] = [
  {
    scope: 'project',
    dir: '.agents/skills',
    truncated: false,
    skills: [
      {
        id: 'a',
        name: 'code-review',
        description:
          'Review the current diff for correctness bugs and reuse / simplification / efficiency cleanups at the given effort level (low/medium/high/max).',
        version: '1.2.0',
        author: 'loro-dev',
        relativePath: '.agents/skills/code-review/SKILL.md',
        isSymlink: false,
      },
      {
        id: 'b',
        name: 'deep-research',
        description:
          'Fan-out web searches, fetch sources, adversarially verify claims, then synthesize a cited report.',
        version: '0.4.1',
        author: 'gstack',
        relativePath: '.agents/skills/deep-research/SKILL.md',
        isSymlink: true,
        symlinkTarget: '.agents/skills/research',
      },
      {
        id: 'c',
        name: 'browse',
        relativePath: '.agents/skills/browse/SKILL.md',
        isSymlink: false,
      },
    ],
  },
  {
    scope: 'project',
    dir: '.qwen/skills',
    truncated: false,
    skills: [
      {
        id: 'q',
        name: 'qwen-helper',
        description: 'A Qwen-only project skill (filtered out for non-Qwen providers).',
        relativePath: '.qwen/skills/qwen-helper/SKILL.md',
        isSymlink: false,
      },
    ],
  },
  {
    scope: 'global',
    dir: '~/.claude/skills',
    truncated: false,
    skills: [
      {
        id: 'd',
        name: 'konsta-ui',
        description: 'Guide to using Konsta UI for pixel-perfect iOS and Material Design components.',
        author: 'me',
        relativePath: '~/.claude/skills/konsta-ui/SKILL.md',
        isSymlink: false,
      },
    ],
  },
];

const ITEMS = buildSkillMentionItems(GROUPS);

type HarnessProps = {
  status: ReturnType<typeof useProjectSkills>['status'];
  empty?: boolean;
  allowedDirs?: ReadonlySet<string> | null;
};

function Harness({ status, empty = false, allowedDirs = null }: HarnessProps) {
  return (
    <div className="h-[460px] w-[760px] p-6">
      <Mention
        open
        triggers={['$']}
        trigger="$"
        inputValue="$"
        onInputValueChange={() => {}}
        mentions={[]}
        onMentionsChange={() => {}}
        value={[]}
        onValueChange={() => {}}
        onFilter={(options) => options}
        autoCloseOnEmpty={false}
      >
        <MentionInput
          value="$"
          onChange={() => {}}
          className="w-full rounded-md border border-input-border bg-input p-2"
          aria-label="composer"
          autoFocus
        />
        <SkillMentionMenu
          skillItems={empty ? [] : ITEMS}
          status={status}
          allowedDirs={allowedDirs}
        />
      </Mention>
    </div>
  );
}

const meta = {
  title: 'Mentions/SkillMentionMenu',
  component: Harness,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Harness>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = {
  args: { status: 'ready' },
};

export const ProviderFiltered: Story = {
  // Claude provider → .agents/skills + ~/.claude/skills (no .qwen/skills).
  args: { status: 'ready', allowedDirs: new Set(['.agents/skills', '~/.claude/skills']) },
};

export const Loading: Story = {
  args: { status: 'loading', empty: true },
};

export const Empty: Story = {
  args: { status: 'ready', empty: true },
};

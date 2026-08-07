import type { Meta, StoryObj } from '@storybook/react';
import { TreeView, type TreeDataItem } from '@/components/tree-view';
import {
  createFileIconComponent,
  createFolderIconComponent,
  DefaultFileIcon,
  DefaultFolderIcon,
} from '@/components/icons/file-icons';

// Mirrors the repo-root file list rendered by FileTreeView (collapsed folders +
// files). TreeView is the shared row renderer, so this story exercises the same
// row height / padding used in the session "Files" tab.
const folder = (name: string): TreeDataItem => ({
  id: name,
  name,
  icon: createFolderIconComponent(name),
  openIcon: createFolderIconComponent(name),
  forceNode: true,
  children: [],
});

const file = (name: string): TreeDataItem => ({
  id: name,
  name,
  icon: createFileIconComponent(name),
});

const repoRoot: TreeDataItem[] = [
  folder('.changeset'),
  folder('.cursor'),
  folder('.devcontainer'),
  folder('.github'),
  folder('.vscode'),
  folder('crates'),
  folder('docs'),
  folder('examples'),
  folder('moon'),
  folder('packages'),
  folder('plans'),
  folder('scripts'),
  folder('skills'),
  folder('sponsorkit'),
  folder('supply-chain'),
  file('.editorconfig'),
  file('.gitignore'),
  file('AGENTS.md'),
  file('Cargo.lock'),
  file('Cargo.toml'),
  file('cliff.toml'),
  file('CONTRIBUTING.md'),
  file('deno.lock'),
  file('deny.toml'),
  file('LICENSE'),
  file('package.json'),
  file('pnpm-lock.yaml'),
  file('pnpm-workspace.yaml'),
  file('README.md'),
  file('rust-toolchain'),
  file('sponsorkit.config.js'),
];

// Mirror FileTreeView's container: the tree sits inside a padded wrapper while
// TreeView itself runs with p-0, so this is the padding between the list and the
// surrounding panel frame.
function RepoRootFileTree() {
  return (
    <div className="p-1">
      <TreeView
        data={repoRoot}
        defaultNodeIcon={DefaultFolderIcon}
        defaultLeafIcon={DefaultFileIcon}
        className="p-0"
      />
    </div>
  );
}

const meta = {
  title: 'Sessions/FileTreeList',
  component: RepoRootFileTree,
  parameters: {
    layout: 'centered',
  },
  decorators: [
    (Story) => (
      <div className="h-[640px] w-[320px] overflow-auto border border-border bg-background">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof RepoRootFileTree>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RepoRoot: Story = {};

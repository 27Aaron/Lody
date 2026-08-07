import { useMemo } from 'react';
import {
  compoundExtensionMap,
  extensionMap,
  fileNameMap,
  folderNameMap,
  defaultFileIcon,
  defaultFolderIcon,
} from './mappings';

// Get the file name from a path
const getFileName = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? filePath;
};

// Get icon name for a file
export const getFileIconName = (filePath: string): string => {
  const fileName = getFileName(filePath).toLowerCase();

  // Check exact file name match first
  if (fileNameMap[fileName]) {
    return fileNameMap[fileName];
  }

  // Also check with original case for case-sensitive names like LICENSE
  const originalFileName = getFileName(filePath);
  if (fileNameMap[originalFileName]) {
    return fileNameMap[originalFileName];
  }

  // Check compound extensions (e.g., .d.ts, .test.ts)
  for (const [ext, icon] of Object.entries(compoundExtensionMap)) {
    if (fileName.endsWith('.' + ext)) {
      return icon;
    }
  }

  // Check simple extension
  const lastDotIndex = fileName.lastIndexOf('.');
  if (lastDotIndex !== -1) {
    const ext = fileName.slice(lastDotIndex + 1);
    if (extensionMap[ext]) {
      return extensionMap[ext];
    }
  }

  return defaultFileIcon;
};

// Get icon name for a folder
export const getFolderIconName = (folderPath: string): string => {
  const folderName = getFileName(folderPath).toLowerCase();

  if (folderNameMap[folderName]) {
    return folderNameMap[folderName];
  }

  return defaultFolderIcon;
};

interface FileIconProps {
  filePath: string;
  className?: string;
}

interface FolderIconProps {
  folderPath: string;
  className?: string;
}

// Create icon URL from icon name
const getFileIconUrl = (iconName: string): string => {
  return new URL(`./files/${iconName}.svg`, import.meta.url).href;
};

const getFolderIconUrl = (iconName: string): string => {
  return new URL(`./folders/${iconName}.svg`, import.meta.url).href;
};

export const FileIcon = ({ filePath, className = 'h-4 w-4' }: FileIconProps) => {
  const iconUrl = useMemo(() => {
    const iconName = getFileIconName(filePath);
    return getFileIconUrl(iconName);
  }, [filePath]);

  return <img src={iconUrl} alt="" className={className} />;
};

export const FolderIcon = ({ folderPath, className = 'h-4 w-4' }: FolderIconProps) => {
  const iconUrl = useMemo(() => {
    const iconName = getFolderIconName(folderPath);
    return getFolderIconUrl(iconName);
  }, [folderPath]);

  return <img src={iconUrl} alt="" className={className} />;
};

// Factory function to create icon components for TreeView
export const createFileIconComponent = (filePath: string) => {
  const FileIconComponent = ({ className }: { className?: string }) => (
    <FileIcon filePath={filePath} className={className} />
  );
  FileIconComponent.displayName = 'FileIconComponent';
  return FileIconComponent;
};

export const createFolderIconComponent = (folderPath: string) => {
  const FolderIconComponent = ({ className }: { className?: string }) => (
    <FolderIcon folderPath={folderPath} className={className} />
  );
  FolderIconComponent.displayName = 'FolderIconComponent';
  return FolderIconComponent;
};

// Default icon components for TreeView fallback
export const DefaultFileIcon = ({ className = 'h-4 w-4' }: { className?: string }) => {
  const iconUrl = getFileIconUrl(defaultFileIcon);
  return <img src={iconUrl} alt="" className={className} />;
};

export const DefaultFolderIcon = ({ className = 'h-4 w-4' }: { className?: string }) => {
  const iconUrl = getFolderIconUrl(defaultFolderIcon);
  return <img src={iconUrl} alt="" className={className} />;
};

import { LODY_SUBAGENT_TASK_LIFECYCLE_RAW_INPUT_KEY } from '@lody/shared';
import { convertTaskLifecycleNotification } from './claude-task-lifecycle';

export const KIMI_TASK_LIFECYCLE_EXTENSION_METHOD = 'kimi/taskLifecycle';

export const convertKimiTaskLifecycleNotification = (params: unknown) =>
  convertTaskLifecycleNotification(params, {
    rawInputKey: LODY_SUBAGENT_TASK_LIFECYCLE_RAW_INPUT_KEY,
    defaultActor: 'Kimi task',
  });

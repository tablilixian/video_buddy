import type { ClipboardEnv } from '../../clipboard-copy.js';
/** 共享单例：env 无状态，没必要每次调用新建。 */
export declare function clipboardEnv(): ClipboardEnv;

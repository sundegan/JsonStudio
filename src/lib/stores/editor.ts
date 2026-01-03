// 编辑器状态管理
import { writable } from 'svelte/store';

// 编辑器状态接口
interface EditorState {
  content: string;      // 当前编辑内容
  isValid: boolean;     // 是否有效 JSON
  errorMessage: string; // 错误信息
  isLoading: boolean;   // 是否正在处理
}

// 初始状态
const initialState: EditorState = {
  content: '',
  isValid: true,
  errorMessage: '',
  isLoading: false
};

// 创建 store
function createEditorStore() {
  const { subscribe, set, update } = writable<EditorState>(initialState);

  return {
    subscribe,
    // 设置内容
    setContent: (content: string) => {
      update(state => ({ ...state, content }));
    },
    // 设置校验结果
    setValidation: (isValid: boolean, errorMessage: string = '') => {
      update(state => ({ ...state, isValid, errorMessage }));
    },
    // 设置加载状态
    setLoading: (isLoading: boolean) => {
      update(state => ({ ...state, isLoading }));
    },
    // 重置状态
    reset: () => set(initialState)
  };
}

export const editorStore = createEditorStore();


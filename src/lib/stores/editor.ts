// Editor state management
import { writable } from 'svelte/store';

// Editor state interface
interface EditorState {
  content: string;      // Current editing content
  isValid: boolean;     // Whether JSON is valid
  errorMessage: string; // Error message
  isLoading: boolean;   // Whether processing
}

// Initial state
const initialState: EditorState = {
  content: '',
  isValid: true,
  errorMessage: '',
  isLoading: false
};

// Create store
function createEditorStore() {
  const { subscribe, set, update } = writable<EditorState>(initialState);

  return {
    subscribe,
    // Set content
    setContent: (content: string) => {
      update(state => ({ ...state, content }));
    },
    // Set validation result
    setValidation: (isValid: boolean, errorMessage: string = '') => {
      update(state => ({ ...state, isValid, errorMessage }));
    },
    // Set loading state
    setLoading: (isLoading: boolean) => {
      update(state => ({ ...state, isLoading }));
    },
    // Reset state
    reset: () => set(initialState)
  };
}

export const editorStore = createEditorStore();


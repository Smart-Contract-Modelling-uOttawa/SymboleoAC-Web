import { useCallback, useMemo } from 'react';
import { LogLevel } from '@codingame/monaco-vscode-api';
import * as monaco from '@codingame/monaco-vscode-editor-api';
import { MonacoEditorReactComp } from '@typefox/monaco-editor-react';
import type { EditorAppConfig } from 'monaco-languageclient/editorApp';
import type { LanguageClientConfig } from 'monaco-languageclient/lcwrapper';
import type { MonacoVscodeApiConfig } from 'monaco-languageclient/vscodeApiWrapper';
import { LSP_URL } from '../config.js';
import {
  SYMBOLEOAC_FILE_EXTENSION,
  SYMBOLEOAC_LANGUAGE_ID,
  symboleoacLanguageConfiguration,
  symboleoacMonarchLanguage,
} from './symboleoac.monarch.js';

type Props = {
  initialCode: string;
  initialName: string;
  onTextChanged: (text: string) => void;
};

const FILE_URI_PREFIX = 'file:///workspace/';

// The MonacoEditorReactComp requires a vscodeApiConfig on first mount to bootstrap
// the @codingame/monaco-vscode-api services. We pick the 'classic' editor type with
// the minimal EditorService views config — that's enough for a standalone code editor
// (no full VS Code workbench).
const vscodeApiConfig: MonacoVscodeApiConfig = {
  $type: 'classic',
  viewsConfig: { $type: 'EditorService' },
  logLevel: LogLevel.Warning,
};

export function EditorPane({ initialCode, initialName, onTextChanged }: Props) {
  // Memoize configs so the underlying wrapper isn't torn down on every render.
  const editorAppConfig: EditorAppConfig = useMemo(() => ({
    id: 'symboleoac-main',
    logLevel: LogLevel.Warning,
    codeResources: {
      modified: {
        text: initialCode,
        uri: `${FILE_URI_PREFIX}${initialName}`,
        enforceLanguageId: SYMBOLEOAC_LANGUAGE_ID,
      },
    },
    languageDef: {
      languageExtensionConfig: {
        id: SYMBOLEOAC_LANGUAGE_ID,
        extensions: [SYMBOLEOAC_FILE_EXTENSION],
        aliases: ['SymboleoAC', 'symboleoac'],
      },
      monarchLanguage: symboleoacMonarchLanguage,
    },
    editorOptions: {
      automaticLayout: true,
      minimap: { enabled: false },
      tabSize: 2,
      fontSize: 13,
      scrollBeyondLastLine: false,
      theme: 'vs-dark',
    },
  }), [initialCode, initialName]);

  const languageClientConfig: LanguageClientConfig = useMemo(() => ({
    languageId: SYMBOLEOAC_LANGUAGE_ID,
    connection: {
      options: {
        $type: 'WebSocketUrl',
        url: LSP_URL,
      },
    },
    clientOptions: {
      documentSelector: [{ language: SYMBOLEOAC_LANGUAGE_ID }],
      // Tell the server the workspace root we're using for our synthetic URIs.
      workspaceFolder: {
        index: 0,
        name: 'workspace',
        uri: monaco.Uri.parse('file:///workspace'),
      },
    },
    restartOptions: {
      retries: 5,
      timeout: 3000,
    },
  }), []);

  const handleTextChanged = useCallback((txt: { modified?: string }) => {
    if (typeof txt.modified === 'string') onTextChanged(txt.modified);
  }, [onTextChanged]);

  const handleEditorStartDone = useCallback(() => {
    // The languageDef registers the Monarch grammar + language; configuration
    // (brackets, autoclosing pairs, comments) is set separately on monaco.languages.
    monaco.languages.setLanguageConfiguration(
      SYMBOLEOAC_LANGUAGE_ID,
      symboleoacLanguageConfiguration,
    );
  }, []);

  return (
    <MonacoEditorReactComp
      style={{ width: '100%', height: '100%' }}
      vscodeApiConfig={vscodeApiConfig}
      editorAppConfig={editorAppConfig}
      languageClientConfig={languageClientConfig}
      onTextChanged={handleTextChanged}
      onEditorStartDone={handleEditorStartDone}
      logLevel={LogLevel.Warning}
    />
  );
}

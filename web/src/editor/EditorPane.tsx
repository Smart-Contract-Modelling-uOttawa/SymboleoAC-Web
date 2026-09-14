import { useCallback, useEffect, useMemo, useRef } from 'react';
import { LogLevel } from '@codingame/monaco-vscode-api';
import * as monaco from '@codingame/monaco-vscode-editor-api';
import { MonacoEditorReactComp } from '@typefox/monaco-editor-react';
import type { EditorApp, EditorAppConfig } from 'monaco-languageclient/editorApp';
import type { LanguageClientConfig, LanguageClientManager } from 'monaco-languageclient/lcwrapper';
import { attachLspLifecycle, type LspState } from './lspLifecycle.js';
import type { MonacoVscodeApiConfig } from 'monaco-languageclient/vscodeApiWrapper';
import { LSP_URL } from '../config.js';
import {
  SYMBOLEOAC_FILE_EXTENSION,
  SYMBOLEOAC_LANGUAGE_ID,
  symboleoacLanguageConfiguration,
  symboleoacMonarchLanguage,
} from './symboleoac.monarch.js';
import { registerSymboleoacSignatureHelp } from './signatureHelp.js';
import { applySymboleoacTheme, currentThemeId, defineSymboleoacThemes } from './theme.js';

type Props = {
  initialCode: string;
  initialName: string;
  onTextChanged: (text: string) => void;
  /** Fires once the editor exists, handing back the Monaco editor instance so
   *  the parent can push content into it (sample switch, file open). */
  onEditorReady?: (editor: monaco.editor.IStandaloneCodeEditor) => void;
  /** Connection state of the language client (kept alive and reconnected by lspLifecycle.ts). */
  onConnectionState?: (state: LspState) => void;
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
  // The language server provides semantic tokens (roles, events, assets, norms,
  // rules, types coloured by kind); make sure the editor asks for and renders them.
  userConfiguration: {
    json: JSON.stringify({ 'editor.semanticHighlighting.enabled': true }),
  },
};

export function EditorPane({ initialCode, initialName, onTextChanged, onEditorReady, onConnectionState }: Props) {
  // Heartbeat + reconnection for the language client (see lspLifecycle.ts).
  const lifecycleRef = useRef<(() => void) | null>(null);
  const handleLanguageClientsStartDone = useCallback((lcs: LanguageClientManager) => {
    const wrapper = lcs.getLanguageClientWrapper(SYMBOLEOAC_LANGUAGE_ID);
    if (!wrapper) return;
    lifecycleRef.current?.();
    lifecycleRef.current = attachLspLifecycle(wrapper, (s) => onConnectionState?.(s));
  }, [onConnectionState]);
  useEffect(() => () => { lifecycleRef.current?.(); lifecycleRef.current = null; }, []);

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
      tabSize: 3,          // SymboleoAC formatter indents 3 spaces; LSP honors this
      insertSpaces: true,
      fontSize: 13,
      scrollBeyondLastLine: false,
      // Our theme, not 'vs-dark': the wrapper re-applies these options on every config
      // pass, and updateOptions({theme}) switches Monaco's global theme.
      theme: currentThemeId(),
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

  // Define the themes as soon as the monaco-vscode-api services exist, i.e. before the
  // editor is created with `theme: currentThemeId()` (an unknown theme name would fall
  // back to the light 'vs' theme).
  const handleApiInitDone = useCallback(() => {
    defineSymboleoacThemes(monaco);
  }, []);

  const handleEditorStartDone = useCallback((editorApp?: EditorApp) => {
    // The languageDef registers the Monarch grammar + language; configuration
    // (brackets, autoclosing pairs, comments) is set separately on monaco.languages.
    monaco.languages.setLanguageConfiguration(
      SYMBOLEOAC_LANGUAGE_ID,
      symboleoacLanguageConfiguration,
    );
    registerSymboleoacSignatureHelp(monaco, SYMBOLEOAC_LANGUAGE_ID);
    // Distinct colours per kind of element (roles, events, norms, rules, types, ...):
    // the theme maps the server's semantic token types to colours.
    applySymboleoacTheme(monaco);
    const editor = editorApp?.getEditor();
    if (editor) onEditorReady?.(editor);
  }, [onEditorReady]);

  return (
    <MonacoEditorReactComp
      style={{ width: '100%', height: '100%' }}
      vscodeApiConfig={vscodeApiConfig}
      editorAppConfig={editorAppConfig}
      languageClientConfig={languageClientConfig}
      onTextChanged={handleTextChanged}
      onVscodeApiInitDone={handleApiInitDone}
      onEditorStartDone={handleEditorStartDone}
      onLanguageClientsStartDone={handleLanguageClientsStartDone}
      logLevel={LogLevel.Warning}
    />
  );
}

import * as vscode from 'vscode';
import * as path from 'path';

let panel: vscode.WebviewPanel | undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('Error Analyzer extension is now active');

    // Register the webview provider for the sidebar
    const provider = new ErrorAnalyzerViewProvider(context.extensionUri);
    
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            ErrorAnalyzerViewProvider.viewType,
            provider
        )
    );
}

class ErrorAnalyzerViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'errorAnalyzer.sidebarView';
    private _view?: vscode.WebviewView;

    constructor(private readonly _extensionUri: vscode.Uri) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'analyzeErrors':
                    await this._analyzeCurrentFile();
                    break;
            }
        });
    }

    private async _analyzeCurrentFile() {
        if (!this._view) {
            return;
        }

        const editor = vscode.window.activeTextEditor;
        
        if (!editor) {
            this._view.webview.postMessage({
                command: 'showResult',
                text: 'No active file found. Please open a file first.'
            });
            return;
        }

        const document = editor.document;
        const diagnostics = vscode.languages.getDiagnostics(document.uri);
        
        const errors = diagnostics.filter(d => d.severity === vscode.DiagnosticSeverity.Error);
        
        if (errors.length === 0) {
            this._view.webview.postMessage({
                command: 'showResult',
                text: 'No errors found in the current file! 🎉'
            });
            return;
        }

        let errorContext = `File: ${path.basename(document.fileName)}\n\n`;
        errors.forEach((err, idx) => {
            const line = document.lineAt(err.range.start.line);
            errorContext += `Error ${idx + 1}: ${err.message}\n`;
            errorContext += `Line ${err.range.start.line + 1}: ${line.text.trim()}\n\n`;
        });

        this._view.webview.postMessage({
            command: 'analyzeWithAI',
            errorContext: errorContext
        });
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Error Analyzer</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            padding: 15px;
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            font-size: 13px;
        }
        h2 {
            font-size: 16px;
            margin-top: 0;
            margin-bottom: 10px;
        }
        p {
            margin: 10px 0;
            line-height: 1.4;
        }
        button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            cursor: pointer;
            font-size: 13px;
            border-radius: 2px;
            margin-bottom: 15px;
            width: 100%;
        }
        button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        #result {
            margin-top: 15px;
            padding: 12px;
            background-color: var(--vscode-textBlockQuote-background);
            border-left: 3px solid var(--vscode-textBlockQuote-border);
            border-radius: 3px;
            white-space: pre-wrap;
            word-wrap: break-word;
            font-size: 12px;
            line-height: 1.5;
        }
        #status {
            margin-top: 8px;
            font-style: italic;
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
        }
        .loading {
            display: inline-block;
            width: 10px;
            height: 10px;
            border: 2px solid var(--vscode-button-background);
            border-top-color: transparent;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin-left: 6px;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <h2>🔍 Error Analyzer</h2>
    <p>Analyze errors in your active file using a local AI model.</p>
    
    <button id="analyzeBtn" onclick="analyzeErrors()">Analyze Errors</button>
    <div id="status"></div>
    <div id="result"></div>

    <script type="module">
        import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';

        // Configure transformers.js
        env.allowLocalModels = false;
        env.allowRemoteModels = true;
        env.useBrowserCache = true;

        const vscode = acquireVsCodeApi();
        let generator;
        let isInitialized = false;
        let initAttempts = 0;
        const MAX_ATTEMPTS = 3;

        async function initModel() {
            const statusEl = document.getElementById('status');
            const analyzeBtn = document.getElementById('analyzeBtn');
            
            if (isInitialized) return;
            
            initAttempts++;
            
            try {
                statusEl.innerHTML = \`Loading AI model (attempt \${initAttempts}/\${MAX_ATTEMPTS})...<span class="loading"></span>\`;
                analyzeBtn.disabled = true;
                
                // Use Xenova's hosted model with explicit configuration
                generator = await pipeline(
                    'text2text-generation', 
                    'Xenova/flan-t5-base',
                    {
                        progress_callback: (progress) => {
                            if (progress.status === 'downloading') {
                                const percent = Math.round(progress.progress || 0);
                                statusEl.innerHTML = \`Downloading model: \${percent}%<span class="loading"></span>\`;
                            } else if (progress.status === 'loading') {
                                statusEl.innerHTML = 'Loading model into memory...<span class="loading"></span>';
                            }
                        }
                    }
                );
                
                isInitialized = true;
                statusEl.innerHTML = '✓ Model ready!';
                analyzeBtn.disabled = false;
                
                setTimeout(() => {
                    statusEl.innerHTML = '';
                }, 3000);
            } catch (error) {
                console.error('Model initialization error:', error);
                
                if (initAttempts < MAX_ATTEMPTS) {
                    statusEl.innerHTML = \`✗ Error: \${error.message}<br>Retrying in 2 seconds...\`;
                    setTimeout(() => initModel(), 2000);
                } else {
                    statusEl.innerHTML = \`✗ Failed to load model after \${MAX_ATTEMPTS} attempts.<br>Error: \${error.message}<br><br>Try refreshing the panel or checking your internet connection.\`;
                    analyzeBtn.disabled = false;
                    analyzeBtn.textContent = 'Retry Loading Model';
                    analyzeBtn.onclick = () => {
                        initAttempts = 0;
                        analyzeBtn.textContent = 'Analyze Errors';
                        analyzeBtn.onclick = () => analyzeErrors();
                        initModel();
                    };
                }
            }
        }

        initModel();

        window.analyzeErrors = function() {
            vscode.postMessage({ command: 'analyzeErrors' });
        };

        window.addEventListener('message', async event => {
            const message = event.data;
            const resultEl = document.getElementById('result');
            const statusEl = document.getElementById('status');
            const analyzeBtn = document.getElementById('analyzeBtn');

            switch (message.command) {
                case 'showResult':
                    resultEl.textContent = message.text;
                    break;
                    
                case 'analyzeWithAI':
                    if (!isInitialized) {
                        resultEl.textContent = 'Please wait for model to initialize...';
                        return;
                    }
                    
                    try {
                        analyzeBtn.disabled = true;
                        statusEl.innerHTML = 'Analyzing...<span class="loading"></span>';
                        resultEl.textContent = 'Processing...';
                        const prompt = \`Fix this programming error:
                        Error: \${message.errorContext}
                        \Solution:\`;
                        
                        const result = await generator(prompt, {
                        max_new_tokens: 512,        // Changed from max_length
                        min_length: 10,             // Force minimum output
                        temperature: 0.3,           // Lower = more focused (was 0.7)
                        top_p: 0.95,               // Slightly higher
                        top_k: 50,                 // Add this - limits vocabulary
                        repetition_penalty: 1.5,   // Higher = less repetition (critical!)
                        no_repeat_ngram_size: 3,   // Prevent 3-word repetitions
                        do_sample: true,
                        num_beams: 2,              // Beam search for better quality
                        early_stopping: true
                    });
                        
                        const explanation = result[0].generated_text;
                        resultEl.textContent = \`📚 AI Analysis:\n\n\${explanation}\n\n---\n\nOriginal Errors:\n\${message.errorContext}\`;
                        statusEl.innerHTML = '';
                        analyzeBtn.disabled = false;
                        
                    } catch (error) {
                        resultEl.textContent = 'Error during analysis: ' + error.message;
                        statusEl.innerHTML = '';
                        analyzeBtn.disabled = false;
                    }
                    break;
            }
        });
    </script>
</body>
</html>`;
    }
}



export function deactivate() {}
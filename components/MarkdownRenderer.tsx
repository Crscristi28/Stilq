import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus, vs } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Copy, Check, Download, Square, CheckSquare } from 'lucide-react';

interface MarkdownRendererProps {
  content: string;
}

const CodeBlock = ({ language, children, ...props }: any) => {
  const [copied, setCopied] = useState(false);
  const isDark = document.documentElement.classList.contains('dark');

  const handleCopy = () => {
    navigator.clipboard.writeText(String(children));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`relative group rounded-lg overflow-hidden my-4 border border-gray-200 dark:border-gray-700/50 shadow-sm ${isDark ? 'bg-[#1e1e1e]' : 'bg-gray-100'}`}>
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-100 dark:bg-[#2d2e33] border-b border-gray-200 dark:border-gray-700/50">
        <span className="text-xs text-gray-600 dark:text-gray-400 font-mono font-medium">{language || 'text'}</span>
        <button 
          onClick={handleCopy} 
          className="flex items-center gap-1.5 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors bg-transparent p-1 rounded hover:bg-gray-200 dark:hover:bg-white/10"
          title="Copy code"
        >
           {copied ? <Check size={14} className="text-green-500 dark:text-green-400"/> : <Copy size={14}/>}
           <span className="text-xs font-medium">{copied ? 'Copied!' : 'Copy'}</span>
        </button>
      </div>
      <div className="overflow-x-auto">
        <SyntaxHighlighter
            {...props}
            style={isDark ? vscDarkPlus : vs}
            language={language}
            PreTag="div"
            customStyle={{ margin: 0, padding: '1rem', background: 'transparent', fontSize: '0.875rem', lineHeight: '1.5' }}
            codeTagProps={{ style: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' } }}
        >
            {String(children).replace(/\n$/, '')}
        </SyntaxHighlighter>
      </div>
    </div>
  );
};

const ImageBlock = ({ src, alt, ...props }: any) => {
  return (
    <div className="relative group my-4 rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700/50 shadow-lg bg-gray-100 dark:bg-black/20 inline-block max-w-full">
      <img 
        src={src} 
        alt={alt} 
        className="w-full h-auto object-contain max-h-[512px]"
        {...props} 
      />
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <a 
          href={src} 
          download={`elora-generated-${Date.now()}.png`}
          className="p-2 bg-white/80 dark:bg-black/50 hover:bg-white dark:hover:bg-black/70 text-gray-900 dark:text-white rounded-lg backdrop-blur-sm transition-colors flex items-center gap-2 shadow-sm border border-gray-200 dark:border-white/10"
          title="Download Image"
        >
          <Download size={16} />
        </a>
      </div>
    </div>
  );
};

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  return (
    <div className="prose prose-sm max-w-none dark:prose-invert leading-7">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: true }]]}
        rehypePlugins={[rehypeKatex]}
        urlTransform={(value) => value} 
        components={{
          code({ node, className, children, ...props }: any) {
            const match = /language-(\w+)/.exec(className || '');
            const hasNewline = String(children).includes('\n');

            // Block code: has language specifier OR contains newlines
            if (match || hasNewline) {
              return <CodeBlock language={match?.[1] || 'text'} children={children} {...props} />;
            }

            // Inline code styling
            return (
              <code {...props} className={`${className || ''} bg-gray-200 dark:bg-white/10 px-1.5 py-0.5 rounded-md text-gray-800 dark:text-gray-200 font-mono text-[0.85em] border border-gray-300 dark:border-white/10 align-middle`}>
                {children}
              </code>
            );
          },
          img: ImageBlock,
          a: ({ node, ...props }) => (
            <a {...props} className="text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 hover:underline transition-colors font-medium break-all" target="_blank" rel="noopener noreferrer" />
          ),
          ul: ({ node, ...props }) => (
             <ul {...props} className="list-disc list-outside ml-4 mb-4 text-gray-700 dark:text-gray-300 space-y-1" />
          ),
          ol: ({ node, ...props }) => (
            <ol {...props} className="list-decimal list-outside ml-4 mb-4 text-gray-700 dark:text-gray-300 space-y-1" />
         ),
         li: ({ node, ...props }) => (
            <li {...props} className="pl-1" />
         ),
         p: ({ node, ...props }) => (
            <p {...props} className="mb-4 leading-relaxed text-gray-800 dark:text-gray-200 last:mb-0" />
         ),
         h1: ({ node, ...props }) => (
            <h1 {...props} className="text-2xl font-bold mb-4 text-gray-900 dark:text-white mt-8 first:mt-0 pb-2 border-b border-gray-200 dark:border-gray-800" />
         ),
         h2: ({ node, ...props }) => (
            <h2 {...props} className="text-xl font-semibold mb-3 text-gray-900 dark:text-white mt-6 first:mt-0" />
         ),
         h3: ({ node, ...props }) => (
            <h3 {...props} className="text-lg font-medium mb-2 text-gray-900 dark:text-white mt-4" />
         ),
         strong: ({ node, ...props }) => (
            <strong {...props} className="font-bold text-gray-900 dark:text-white" />
         ),
         blockquote: ({ node, ...props }) => (
            <blockquote {...props} className="border-l-4 border-blue-500/30 dark:border-blue-500/50 pl-4 py-1 italic text-gray-600 dark:text-gray-400 my-4 bg-gray-50 dark:bg-white/5 rounded-r-lg" />
         ),
         table: ({ node, ...props }) => (
            <div className="overflow-x-auto my-4">
               <table {...props} className="min-w-full divide-y divide-gray-200 dark:divide-gray-800 rounded-lg border border-gray-200 dark:border-gray-800" />
            </div>
         ),
         thead: ({ node, ...props }) => (
            <thead {...props} className="bg-gray-50 dark:bg-white/5" />
         ),
         tbody: ({ node, ...props }) => (
            <tbody {...props} className="divide-y divide-gray-200 dark:divide-gray-800 bg-white dark:bg-transparent" />
         ),
         tr: ({ node, ...props }) => (
            <tr {...props} />
         ),
         th: ({ node, ...props }) => (
            <th {...props} className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider" />
         ),
         td: ({ node, ...props }) => (
            <td {...props} className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap" />
         ),
         del: ({ node, ...props }) => (
            <del {...props} className="line-through text-gray-500 dark:text-gray-400" />
         ),
         em: ({ node, ...props }) => (
            <em {...props} className="italic text-gray-800 dark:text-gray-200" />
         ),
         hr: ({ node, ...props }) => (
            <hr {...props} className="my-6 border-t border-gray-200 dark:border-gray-700" />
         ),
         h4: ({ node, ...props }) => (
            <h4 {...props} className="text-base font-medium mb-2 text-gray-900 dark:text-white mt-4" />
         ),
         h5: ({ node, ...props }) => (
            <h5 {...props} className="text-sm font-medium mb-1 text-gray-900 dark:text-white mt-3" />
         ),
         h6: ({ node, ...props }) => (
            <h6 {...props} className="text-sm font-medium mb-1 text-gray-600 dark:text-gray-400 mt-3" />
         ),
         // Task list checkbox (GFM)
         input: ({ node, checked, ...props }: any) => (
            <span className="inline-flex items-center mr-2">
               {checked ? (
                  <CheckSquare size={16} className="text-green-500 dark:text-green-400" />
               ) : (
                  <Square size={16} className="text-gray-400 dark:text-gray-500" />
               )}
            </span>
         ),
         // Superscript (if supported)
         sup: ({ node, ...props }) => (
            <sup {...props} className="text-xs align-super text-gray-600 dark:text-gray-400" />
         ),
         // Subscript (if supported)
         sub: ({ node, ...props }) => (
            <sub {...props} className="text-xs align-sub text-gray-600 dark:text-gray-400" />
         ),
         // Preformatted text
         pre: ({ node, children, ...props }) => (
            <>{children}</>
         ),
         // Abbreviation
         abbr: ({ node, ...props }) => (
            <abbr {...props} className="underline decoration-dotted cursor-help text-gray-800 dark:text-gray-200" />
         ),
         // Keyboard input
         kbd: ({ node, ...props }) => (
            <kbd {...props} className="px-1.5 py-0.5 text-xs font-mono bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded shadow-sm text-gray-800 dark:text-gray-200" />
         ),
         // Mark/highlight
         mark: ({ node, ...props }) => (
            <mark {...props} className="bg-yellow-200 dark:bg-yellow-500/30 px-0.5 rounded text-gray-900 dark:text-gray-100" />
         ),
         // Definition list
         dl: ({ node, ...props }) => (
            <dl {...props} className="my-4 space-y-2" />
         ),
         dt: ({ node, ...props }) => (
            <dt {...props} className="font-semibold text-gray-900 dark:text-white" />
         ),
         dd: ({ node, ...props }) => (
            <dd {...props} className="ml-4 text-gray-700 dark:text-gray-300" />
         ),
         // Section
         section: ({ node, ...props }) => (
            <section {...props} className="my-4" />
         ),
         // Div fallback
         div: ({ node, ...props }) => (
            <div {...props} />
         ),
         // Span fallback
         span: ({ node, ...props }) => (
            <span {...props} />
         ),
         // Break
         br: ({ node, ...props }) => (
            <br {...props} />
         ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};

export default MarkdownRenderer;
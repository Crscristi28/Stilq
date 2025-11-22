import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Copy, Check, Download } from 'lucide-react';

interface MarkdownRendererProps {
  content: string;
}

const CodeBlock = ({ language, children, ...props }: any) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(String(children));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group rounded-lg overflow-hidden my-4 border border-gray-200 dark:border-gray-700/50 bg-[#1e1e1e]">
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-100 dark:bg-[#2d2e33] border-b border-gray-200 dark:border-gray-700/50">
        <span className="text-xs text-gray-600 dark:text-gray-400 lowercase font-mono">{language}</span>
        <button 
          onClick={handleCopy} 
          className="flex items-center gap-1.5 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors bg-transparent p-1 rounded"
          title="Copy code"
        >
           {copied ? <Check size={14} className="text-green-500 dark:text-green-400"/> : <Copy size={14}/>}
           <span className="text-xs font-medium">{copied ? 'Copied!' : 'Copy'}</span>
        </button>
      </div>
      <div className="overflow-x-auto">
        <SyntaxHighlighter
            {...props}
            style={vscDarkPlus}
            language={language}
            PreTag="div"
            customStyle={{ margin: 0, padding: '1rem', background: 'transparent', fontSize: '0.875rem' }}
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
    <div className="prose prose-sm max-w-none dark:prose-invert">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(value) => value} 
        components={{
          code({ node, inline, className, children, ...props }: any) {
            const match = /language-(\w+)/.exec(className || '');
            // Treat as block if not inline, regardless of regex match
            if (!inline) {
              return <CodeBlock language={match ? match[1] : 'text'} children={children} {...props} />;
            }
            return (
              <code {...props} className={`${className || ''} bg-gray-200 dark:bg-gray-800 px-1.5 py-0.5 rounded text-gray-800 dark:text-gray-200 font-mono text-sm`}>
                {children}
              </code>
            );
          },
          img: ImageBlock,
          a: ({ node, ...props }) => (
            <a {...props} className="text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 hover:underline transition-colors" target="_blank" rel="noopener noreferrer" />
          ),
          ul: ({ node, ...props }) => (
             <ul {...props} className="list-disc list-outside ml-4 mb-4 text-gray-700 dark:text-gray-300" />
          ),
          ol: ({ node, ...props }) => (
            <ol {...props} className="list-decimal list-outside ml-4 mb-4 text-gray-700 dark:text-gray-300" />
         ),
         p: ({ node, ...props }) => (
            <p {...props} className="mb-4 leading-relaxed text-gray-800 dark:text-gray-100 last:mb-0" />
         ),
         h1: ({ node, ...props }) => (
            <h1 {...props} className="text-2xl font-bold mb-4 text-gray-900 dark:text-white mt-6 first:mt-0" />
         ),
         h2: ({ node, ...props }) => (
            <h2 {...props} className="text-xl font-semibold mb-3 text-gray-900 dark:text-white mt-5 first:mt-0" />
         ),
         h3: ({ node, ...props }) => (
            <h3 {...props} className="text-lg font-medium mb-2 text-gray-900 dark:text-white mt-4" />
         ),
         strong: ({ node, ...props }) => (
            <strong {...props} className="font-bold text-gray-900 dark:text-white" />
         ),
         blockquote: ({ node, ...props }) => (
            <blockquote {...props} className="border-l-4 border-gray-300 dark:border-gray-600 pl-4 italic text-gray-600 dark:text-gray-400 my-4" />
         ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};

export default MarkdownRenderer;
import React from 'react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Brain } from 'lucide-react';

const MarkdownRenderer = ({ content }) => {
  return (
    <ReactMarkdown
      components={{
        code({ node, inline, className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || '');
          if (!inline && match && match[1] === 'thought') {
            return (
              <div style={{ background: '#2c2c2c', color: '#a0a0a0', padding: '0.75rem', borderRadius: '4px', borderLeft: '3px solid #666', fontStyle: 'italic', marginBottom: '1rem', fontSize: '0.85rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', fontWeight: 'bold', color: '#bbb' }}>
                  <Brain size={14} /> Thought Process
                </div>
                {String(children).replace(/\n$/, '')}
              </div>
            );
          }
          return !inline && match ? (
            <SyntaxHighlighter style={vscDarkPlus} language={match[1]} PreTag="div" {...props}>
              {String(children).replace(/\n$/, '')}
            </SyntaxHighlighter>
          ) : (
            <code className={className} {...props}>{children}</code>
          );
        }
      }}
    >
      {content ? content.replace(/<think>/g, '```thought\n').replace(/<\/think>/g, '\n```\n') : ''}
    </ReactMarkdown>
  );
};

export default MarkdownRenderer;

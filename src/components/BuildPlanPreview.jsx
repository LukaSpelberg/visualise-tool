import React, { useState, useCallback } from 'react';

/**
 * BuildPlanPreview - Renders a build plan in a nice formatted view
 * with the ability to add inline comments to specific lines.
 */
const BuildPlanPreview = ({ 
  plan, 
  onSendFeedback, 
  onClose,
  isSubmitting = false,
  openTabs = [],
  activeFilePath,
  onTabClick,
  onTabClose
}) => {
  // Each line can have a comment attached
  const [comments, setComments] = useState({});
  // Which line is currently being commented on
  const [activeCommentLine, setActiveCommentLine] = useState(null);
  // Input value for the active comment
  const [commentInput, setCommentInput] = useState('');

  // Check if a specific tab is dirty
  const isTabDirty = (tab) => tab.content !== tab.savedContent;

  // Parse the plan summary into lines for annotation
  const planLines = (plan?.summary || '').split('\n').filter(line => line.trim());

  // Handle clicking on a line to add a comment
  const handleLineClick = useCallback((lineIndex) => {
    if (activeCommentLine === lineIndex) {
      // Toggle off if clicking the same line
      setActiveCommentLine(null);
      setCommentInput('');
    } else {
      setActiveCommentLine(lineIndex);
      setCommentInput(comments[lineIndex] || '');
    }
  }, [activeCommentLine, comments]);

  // Save comment for a line
  const handleSaveComment = useCallback((lineIndex) => {
    if (commentInput.trim()) {
      setComments(prev => ({
        ...prev,
        [lineIndex]: commentInput.trim()
      }));
    } else {
      // Remove comment if empty
      setComments(prev => {
        const newComments = { ...prev };
        delete newComments[lineIndex];
        return newComments;
      });
    }
    setActiveCommentLine(null);
    setCommentInput('');
  }, [commentInput]);

  // Remove a comment
  const handleRemoveComment = useCallback((lineIndex) => {
    setComments(prev => {
      const newComments = { ...prev };
      delete newComments[lineIndex];
      return newComments;
    });
  }, []);

  // Compile all comments and send as feedback
  const handleSendFeedback = useCallback(() => {
    const commentEntries = Object.entries(comments);
    
    if (commentEntries.length === 0) {
      // No comments, just approve
      onSendFeedback?.({ type: 'approve', comments: [] });
      return;
    }

    // Build feedback with line references
    const feedbackItems = commentEntries.map(([lineIndex, comment]) => ({
      lineIndex: parseInt(lineIndex),
      lineContent: planLines[parseInt(lineIndex)] || '',
      comment
    }));

    onSendFeedback?.({ type: 'feedback', comments: feedbackItems });
  }, [comments, planLines, onSendFeedback]);

  // Render a single line with optional comment
  const renderLine = (line, index) => {
    const hasComment = comments[index];
    const isActive = activeCommentLine === index;
    const isHeader = line.startsWith('**') || line.startsWith('##') || line.startsWith('#');
    const isBullet = line.trim().startsWith('•') || line.trim().startsWith('-') || line.trim().startsWith('*');
    
    // Clean up markdown syntax for display
    let displayLine = line;
    if (line.startsWith('**') && line.endsWith('**')) {
      displayLine = line.slice(2, -2);
    } else if (line.startsWith('## ')) {
      displayLine = line.slice(3);
    } else if (line.startsWith('# ')) {
      displayLine = line.slice(2);
    }

    return (
      <div key={index} className="plan-line-wrapper">
        <div 
          className={`plan-line ${isHeader ? 'header' : ''} ${isBullet ? 'bullet' : ''} ${hasComment ? 'has-comment' : ''} ${isActive ? 'active' : ''}`}
          onClick={() => handleLineClick(index)}
          title="Click to add a comment"
        >
          <span className="plan-line-content">
            {isHeader ? <strong>{displayLine}</strong> : displayLine}
          </span>
          {hasComment && !isActive && (
            <span className="plan-line-comment-indicator" title={comments[index]}>
              💬
            </span>
          )}
          <span className="plan-line-add-comment">+ Comment</span>
        </div>
        
        {/* Show existing comment */}
        {hasComment && !isActive && (
          <div className="plan-line-comment">
            <div className="plan-line-comment-content">
              <span className="comment-label">Your comment:</span>
              <span className="comment-text">{comments[index]}</span>
            </div>
            <button 
              className="plan-line-comment-edit"
              onClick={(e) => {
                e.stopPropagation();
                handleLineClick(index);
              }}
            >
              Edit
            </button>
            <button 
              className="plan-line-comment-remove"
              onClick={(e) => {
                e.stopPropagation();
                handleRemoveComment(index);
              }}
            >
              ×
            </button>
          </div>
        )}
        
        {/* Comment input */}
        {isActive && (
          <div className="plan-line-comment-input">
            <textarea
              value={commentInput}
              onChange={(e) => setCommentInput(e.target.value)}
              placeholder="Add your feedback about this line..."
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSaveComment(index);
                }
                if (e.key === 'Escape') {
                  setActiveCommentLine(null);
                  setCommentInput('');
                }
              }}
            />
            <div className="plan-line-comment-actions">
              <button 
                className="comment-save-btn"
                onClick={() => handleSaveComment(index)}
              >
                Save
              </button>
              <button 
                className="comment-cancel-btn"
                onClick={() => {
                  setActiveCommentLine(null);
                  setCommentInput('');
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const commentCount = Object.keys(comments).length;

  return (
    <section className="panel panel-editor">
      {/* Tabs bar - same as EditorPane */}
      {openTabs.length > 0 && (
        <div className="editor-tabs">
          {openTabs.map(tab => (
            <div 
              key={tab.path}
              className={`editor-tab ${tab.path === activeFilePath ? 'active' : ''}`}
              onClick={() => onTabClick?.(tab.path)}
            >
              <span className="editor-tab-name">
                {tab.name}
                {isTabDirty(tab) && <span className="editor-tab-dirty">●</span>}
              </span>
              {tab.path === activeFilePath && (
                <button 
                  className="editor-tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    onTabClose?.(tab.path);
                  }}
                  title="Close"
                >
                  ×
                </button>
              )}
            </div>
          ))}
          {/* Build Plan tab */}
          <div className="editor-tab active build-plan-tab">
            <span className="editor-tab-name">
              📋 Build Plan
            </span>
            <button 
              className="editor-tab-close"
              onClick={(e) => {
                e.stopPropagation();
                onClose?.();
              }}
              title="Close"
            >
              ×
            </button>
          </div>
        </div>
      )}

      <div className="build-plan-preview">
        <div className="build-plan-header">
          <div className="build-plan-title">
            <span className="build-plan-icon">📋</span>
            <h2>Build Plan</h2>
          </div>
          <p className="build-plan-subtitle">
            Click on any line to add feedback. When you're ready, send your feedback or approve the plan.
          </p>
        </div>

        <div className="build-plan-content">
          {planLines.map((line, index) => renderLine(line, index))}
        </div>

        <div className="build-plan-footer">
          <div className="build-plan-comment-count">
            {commentCount > 0 ? (
              <span>{commentCount} comment{commentCount !== 1 ? 's' : ''} added</span>
            ) : (
              <span className="muted">No comments yet</span>
            )}
          </div>
          <div className="build-plan-actions">
            <button 
            className="build-plan-btn secondary"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button 
            className="build-plan-btn primary"
            onClick={handleSendFeedback}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Building...' : commentCount > 0 ? 'Build with Feedback' : '✓ Approve & Build'}
          </button>
        </div>
      </div>
      </div>
    </section>
  );
};

export default BuildPlanPreview;

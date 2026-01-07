import React, { useState, useRef, useEffect, useCallback } from 'react';

const BuildChat = ({ folderPath, fileBridge }) => {
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [uploadedImage, setUploadedImage] = useState(null); // { base64, preview, mimeType }
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isBuilding, setIsBuilding] = useState(false);
  const [buildPlan, setBuildPlan] = useState(null); // { summary, detailedPrompt, files[] }
  const [awaitingApproval, setAwaitingApproval] = useState(false);
  
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-resize textarea (base ~80px, max ~120px which is 1.5x)
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const baseHeight = 80;
    const maxHeight = Math.round(baseHeight * 1.5); // 120px
    const next = Math.min(ta.scrollHeight, maxHeight);
    ta.style.height = `${Math.max(next, baseHeight)}px`;
    ta.style.overflowY = ta.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [inputValue]);

  // Add a message to the chat
  const addMessage = useCallback((role, content, image = null) => {
    setMessages(prev => [...prev, {
      id: Date.now(),
      role,
      content,
      image,
      timestamp: new Date().toISOString()
    }]);
  }, []);

  // Handle image upload
  const handleImageSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      addMessage('assistant', '⚠️ Please upload a valid image file (PNG, JPG, GIF, or WebP).');
      return;
    }

    // Convert to base64
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1];
      setUploadedImage({
        base64,
        preview: reader.result,
        mimeType: file.type,
        name: file.name
      });
    };
    reader.readAsDataURL(file);
    
    // Clear the input so the same file can be selected again
    e.target.value = '';
  };

  // Remove uploaded image
  const handleRemoveImage = () => {
    setUploadedImage(null);
  };

  // Analyze the design with Gemini
  const handleAnalyzeDesign = async () => {
    if (!uploadedImage || !folderPath) {
      addMessage('assistant', '⚠️ Please open a project folder and upload a design image first.');
      return;
    }

    // Add user message with image
    addMessage('user', inputValue || 'Analyze this design', uploadedImage.preview);
    setInputValue('');
    const imageToAnalyze = uploadedImage;
    setUploadedImage(null);
    setIsAnalyzing(true);

    try {
      // Call the analyze-build-design IPC handler
      const result = await window.editorAPI?.analyzeBuildDesign({
        imageBase64: imageToAnalyze.base64,
        mimeType: imageToAnalyze.mimeType,
        folderPath,
        userMessage: inputValue
      });

      if (!result?.success) {
        addMessage('assistant', `❌ Analysis failed: ${result?.error || 'Unknown error'}`);
        setIsAnalyzing(false);
        return;
      }

      // Store the build plan (includes detailed prompt for Ollama)
      setBuildPlan({
        summary: result.summary,
        detailedPrompt: result.detailedPrompt,
        files: result.files || [],
        components: result.components || [],
        styleGuide: result.styleGuide || null
      });

      // Show the summary to the user
      addMessage('assistant', result.summary);
      setAwaitingApproval(true);

    } catch (err) {
      addMessage('assistant', `❌ Error: ${err.message}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Handle sending a message (for conversation)
  const handleSend = async () => {
    if (!inputValue.trim() && !uploadedImage) return;

    // If there's an image, analyze it
    if (uploadedImage) {
      await handleAnalyzeDesign();
      return;
    }

    // Regular text message for conversation
    addMessage('user', inputValue);
    const userMessage = inputValue;
    setInputValue('');

    // If we're awaiting approval and user wants to refine
    if (awaitingApproval && buildPlan) {
      setIsAnalyzing(true);
      
      try {
        // Refine the plan based on user feedback
        const result = await window.editorAPI?.refineBuildPlan({
          currentPlan: buildPlan,
          userFeedback: userMessage,
          folderPath
        });

        if (!result?.success) {
          addMessage('assistant', `❌ Failed to refine plan: ${result?.error || 'Unknown error'}`);
        } else {
          setBuildPlan({
            summary: result.summary,
            detailedPrompt: result.detailedPrompt,
            files: result.files || [],
            components: result.components || [],
            styleGuide: result.styleGuide || null
          });
          addMessage('assistant', result.summary);
        }
      } catch (err) {
        addMessage('assistant', `❌ Error: ${err.message}`);
      } finally {
        setIsAnalyzing(false);
      }
      return;
    }

    // Otherwise, prompt user to upload an image
    addMessage('assistant', 'Please upload a design image to get started. Click the 📎 button to attach your design.');
  };

  // Start the build process (after user approval)
  const handleStartBuild = async () => {
    if (!buildPlan || !folderPath) return;

    setIsBuilding(true);
    setAwaitingApproval(false);
    addMessage('assistant', '🔨 Starting build process...');

    try {
      const result = await window.editorAPI?.executeBuild({
        buildPlan,
        folderPath
      });

      if (!result?.success) {
        addMessage('assistant', `❌ Build failed: ${result?.error || 'Unknown error'}`);
        setAwaitingApproval(true); // Allow retry
      } else {
        // Show success with created files
        const fileList = result.files?.map(f => `  • ${f.path}`).join('\n') || 'No files created';
        addMessage('assistant', `✅ Build complete!\n\n**Created files:**\n${fileList}\n\nYou can now view and edit these files in the project tree.`);
        setBuildPlan(null);
      }
    } catch (err) {
      addMessage('assistant', `❌ Build error: ${err.message}`);
      setAwaitingApproval(true);
    } finally {
      setIsBuilding(false);
    }
  };

  // Handle Enter key
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Render a single message
  const renderMessage = (msg) => {
    const isUser = msg.role === 'user';
    return (
      <div key={msg.id} className={`build-chat-message ${isUser ? 'user' : 'assistant'}`}>
        {msg.image && (
          <div className="build-chat-message-image">
            <img src={msg.image} alt="Design" />
          </div>
        )}
        <div className="build-chat-message-content">
          {msg.content.split('\n').map((line, i) => (
            <React.Fragment key={i}>
              {line.startsWith('**') && line.endsWith('**') ? (
                <strong>{line.slice(2, -2)}</strong>
              ) : line.startsWith('  •') || line.startsWith('  -') ? (
                <div className="build-chat-list-item">{line}</div>
              ) : (
                line
              )}
              {i < msg.content.split('\n').length - 1 && <br />}
            </React.Fragment>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="build-chat">
      {/* Messages area */}
      <div className="build-chat-messages">
        {messages.length === 0 ? (
          <div className="build-chat-empty">
            <div className="build-chat-empty-icon">🎨</div>
            <h3>Design to Code</h3>
            <p>Upload a design image and I'll help you build it using your existing components and style guide.</p>
            <div className="build-chat-empty-steps">
              <div className="build-chat-step">
                <span className="step-number">1</span>
                <span>Upload your design</span>
              </div>
              <div className="build-chat-step">
                <span className="step-number">2</span>
                <span>Review my build plan</span>
              </div>
              <div className="build-chat-step">
                <span className="step-number">3</span>
                <span>Approve to start building</span>
              </div>
            </div>
          </div>
        ) : (
          <>
            {messages.map(renderMessage)}
            {(isAnalyzing || isBuilding) && (
              <div className="build-chat-message assistant">
                <div className="build-chat-loading">
                  <div className="build-chat-loading-dots">
                    <span></span><span></span><span></span>
                  </div>
                  <span>{isAnalyzing ? 'Analyzing design...' : 'Building...'}</span>
                </div>
              </div>
            )}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Approval button */}
      {awaitingApproval && !isBuilding && (
        <div className="build-chat-approval">
          <button 
            className="build-chat-approve-btn"
            onClick={handleStartBuild}
          >
            ✓ Start Building
          </button>
        </div>
      )}

      {/* Command Box Input */}
      <div className={`build-chat-command-box ${isAnalyzing || isBuilding ? 'disabled' : ''}`}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleImageSelect}
          style={{ display: 'none' }}
        />
        
        {/* Image preview inside command box */}
        {uploadedImage && (
          <div className="command-box-image-preview">
            <img src={uploadedImage.preview} alt="Preview" />
            <button className="command-box-image-remove" onClick={handleRemoveImage} title="Remove">×</button>
            <span className="command-box-image-name">{uploadedImage.name}</span>
          </div>
        )}
        
        <textarea
          ref={textareaRef}
          className="command-box-textarea"
          placeholder="Type anything to start building..."
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isAnalyzing || isBuilding}
          rows={1}
        />
        
        <div className="command-box-footer">
          <button 
            className="command-box-icon-btn"
            onClick={() => fileInputRef.current?.click()}
            title="Attach design image"
            disabled={isAnalyzing || isBuilding}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </button>
          
          <button 
            className="command-box-icon-btn send"
            onClick={handleSend}
            disabled={(!inputValue.trim() && !uploadedImage) || isAnalyzing || isBuilding}
            title="Send"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M22 2L11 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      </div>

      {/* No project warning */}
      {!folderPath && (
        <div className="build-chat-no-project">
          <span>⚠️ Open a project folder to start building</span>
        </div>
      )}
    </div>
  );
};

export default BuildChat;

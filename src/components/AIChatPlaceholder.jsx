import React from 'react';

const AIChatPlaceholder = () => (
  <section className="panel panel-chat">
    <div className="panel-header">
      <h2>AI Assistant</h2>
      <span className="status-pill">Agent</span>
    </div>
    <div className="chat-body">
      <p>Chat responses and actions will show here.</p>
    </div>
    <div className="chat-input">
      <input type="text" placeholder="Type anything to start building..." />
      <button type="button">Send</button>
    </div>
  </section>
);

export default AIChatPlaceholder;

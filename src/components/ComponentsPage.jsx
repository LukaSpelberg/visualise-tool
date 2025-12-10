import React from 'react';

const ComponentsPage = ({ onImport, onCreate }) => {
  return (
    <section className="panel panel-components">
      <div className="panel-header components-header">
        <h2 style={{ margin: 0 }}>Components</h2>
        <button type="button" className="import-components-button" onClick={onImport}>
          Import Component Folder
        </button>
      </div>

      <div className="panel-body components-body">
        <p className="components-description">
          This is the place where you make your building blocks that the AI will use when making your design reality.
        </p>

        <div className="create-component-area">
          <button
            type="button"
            className="create-component-button"
            onClick={onCreate}
            aria-label="Create new component"
          >
            <div className="create-plus">+</div>
            <div className="create-label">Create new component</div>
          </button>
        </div>
      </div>
    </section>
  );
};

export default ComponentsPage;

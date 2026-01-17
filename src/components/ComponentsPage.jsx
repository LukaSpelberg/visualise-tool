import React from 'react';

const ComponentsPage = ({ onImport, onCreate, components = [], onOpenComponent, onCreateTest }) => {
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

        <div className="components-grid">
          <button
            type="button"
            className="create-component-button"
            onClick={onCreate}
            aria-label="Create new component"
          >
            <div className="create-plus">+</div>
            <div className="create-label">Create new component</div>
          </button>


          {components.map(item => (
            <button
              key={item.path}
              type="button"
              className="component-card"
              onClick={() => onOpenComponent?.(item.path)}
              title={item.path}
            >
              <div className="component-card-name">{item.name}</div>
              <div className="component-card-meta">componentAI</div>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
};

export default ComponentsPage;

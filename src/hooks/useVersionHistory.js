
import { useState, useCallback, useMemo } from 'react';

/**
 * useVersionHistory
 * Manages a linear history of states with undo/redo capabilities.
 * 
 * @param {any} initialData The initial state data
 * @param {string} initialDescription Description for the initial state
 * @returns {Object} {
 *   currentVersion,
 *   versions,
 *   addVersion,
 *   goToVersion,
 *   undo,
 *   redo,
 *   canUndo,
 *   canRedo,
 *   reset
 * }
 */
export const useVersionHistory = (initialData, initialDescription = 'Initial') => {
    const [versions, setVersions] = useState([
        {
            id: 0,
            timestamp: Date.now(),
            description: initialDescription,
            data: initialData
        }
    ]);
    const [currentIndex, setCurrentIndex] = useState(0);

    const addVersion = useCallback((data, description) => {
        setVersions(prev => {
            // Truncate future if we branch off
            const history = prev.slice(0, currentIndex + 1);
            const newVersion = {
                id: Date.now(),
                timestamp: Date.now(),
                description,
                data
            };
            return [...history, newVersion];
        });
        setCurrentIndex(prev => prev + 1);
    }, [currentIndex]);

    const goToVersion = useCallback((index) => {
        if (index >= 0 && index < versions.length) {
            setCurrentIndex(index);
        }
    }, [versions.length]);

    const undo = useCallback(() => {
        if (currentIndex > 0) {
            setCurrentIndex(prev => prev - 1);
        }
    }, [currentIndex]);

    const redo = useCallback(() => {
        if (currentIndex < versions.length - 1) {
            setCurrentIndex(prev => prev + 1);
        }
    }, [currentIndex, versions.length]);

    const reset = useCallback((data, description = 'Initial') => {
        setVersions([{
            id: Date.now(),
            timestamp: Date.now(),
            description,
            data
        }]);
        setCurrentIndex(0);
    }, []);

    const currentVersion = useMemo(() => versions[currentIndex], [versions, currentIndex]);

    const canUndo = currentIndex > 0;
    const canRedo = currentIndex < versions.length - 1;

    return {
        currentVersion,
        versions,
        currentIndex,
        addVersion,
        goToVersion,
        undo,
        redo,
        canUndo,
        canRedo,
        reset
    };
};

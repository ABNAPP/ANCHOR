'use client';

import { useEffect } from 'react';

export function PortalStyleFix() {
  useEffect(() => {
    // Function to apply styles to nextjs-portal elements
    const applyPortalStyles = () => {
      const portals = document.querySelectorAll('nextjs-portal');
      portals.forEach((portal) => {
        const element = portal as HTMLElement;
        if (element.style) {
          element.style.left = '1px';
          // Explicitly remove the top property
          element.style.removeProperty('top');
        }
      });
    };

    // Apply immediately
    applyPortalStyles();
    
    // Also apply on next frame to catch any immediate style changes
    requestAnimationFrame(() => {
      applyPortalStyles();
    });

    // Use MutationObserver to catch dynamically added portals and style changes
    const observer = new MutationObserver((mutations) => {
      // Check if any portal elements were added or modified
      let shouldApply = false;
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
          shouldApply = true;
        } else if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
          // Specifically check if target is a portal element
          const target = mutation.target as HTMLElement;
          if (target.tagName?.toLowerCase() === 'nextjs-portal') {
            shouldApply = true;
          }
        }
      });
      if (shouldApply) {
        // Use requestAnimationFrame to ensure DOM is updated
        requestAnimationFrame(() => {
          applyPortalStyles();
        });
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style'],
    });

    // Periodic check as fallback (every 100ms) to ensure styles persist
    const intervalId = setInterval(() => {
      applyPortalStyles();
    }, 100);

    return () => {
      observer.disconnect();
      clearInterval(intervalId);
    };
  }, []);

  return null;
}


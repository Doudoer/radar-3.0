import { useEffect, useState } from 'react';

export const useViewLoading = (viewKey: string) => {
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    let firstFrame = 0;
    let secondFrame = 0;
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => setLoading(false));
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [viewKey]);

  return loading;
};

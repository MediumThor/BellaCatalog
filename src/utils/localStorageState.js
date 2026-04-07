import { useEffect, useState } from 'react';

export function useLocalStorageState(key, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return typeof initialValue === 'function' ? initialValue() : initialValue;
      return JSON.parse(raw);
    } catch {
      return typeof initialValue === 'function' ? initialValue() : initialValue;
    }
  });

  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);

  return [value, setValue];
}

import React, { useState } from 'react';

/**
 * Test Component - Triggers an error to test ErrorBoundary
 * USAGE: Import and add to any page during testing, then remove before production
 * Example: <ErrorTriggerButton />
 */
export default function ErrorTriggerButton(): React.ReactElement {
  const [shouldThrowError, setShouldThrowError] = useState<boolean>(false);

  if (shouldThrowError) {
    throw new Error(
      'Test error triggered by ErrorTriggerButton - ErrorBoundary should catch this!'
    );
  }

  return (
    <button
      onClick={() => setShouldThrowError(true)}
      className="fixed bottom-4 right-4 bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-lg shadow-lg transition"
      title="For testing ErrorBoundary only - remove before production"
    >
      Trigger Error (Test)
    </button>
  );
}

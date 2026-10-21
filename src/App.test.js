import React from 'react';
import { render, screen } from '@testing-library/react';
import App from './App';

// Jest has no webpack loaders: stand in for the database worker with one that
// never answers (the home page does not need the database)
jest.mock(
  'worker-loader!../workers/DatabaseWorker',
  () =>
    class FakeWorker {
      postMessage() {}
      addEventListener() {}
      removeEventListener() {}
      terminate() {}
    },
  { virtual: true }
);

test('renders the home page', async () => {
  render(<App />);
  expect(
    await screen.findByRole('button', { name: /start game/i })
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /join game/i })).toBeInTheDocument();
});

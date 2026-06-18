export const projectTasks = [
  {
    id: 'p1',
    prompt:
      'Write a SQLite SELECT query that retrieves the total cost in EUR grouped by source from a table called usage_records. ' +
      'The cost column is named cost_eur.',
    keywords: ['SELECT', 'usage_records', 'GROUP BY', 'source', 'SUM', 'cost_eur'],
  },
  {
    id: 'p2',
    prompt:
      'What does importScripts() do in a Chrome MV3 Service Worker? Explain briefly.',
    keywords: ['importScripts', 'script'],
  },
  {
    id: 'p3',
    prompt:
      'Write a JavaScript regular expression that matches a EUR currency amount formatted like "14,90 €" (digits, comma, two decimal places, space, euro sign).',
    keywords: ['/', '€'],
  },
  {
    id: 'p4',
    prompt:
      'What HTTP status code should an API return when a new resource has been successfully created?',
    keywords: ['201'],
  },
  {
    id: 'p5',
    prompt:
      'Write a React useState hook declaration for a string state variable called activeTab with initial value "overview".',
    keywords: ['useState', 'activeTab', 'overview'],
  },
  {
    id: 'p6',
    prompt:
      'What is the Ollama API endpoint (path) to list all locally available models?',
    keywords: ['/api/tags'],
  },
  {
    id: 'p7',
    prompt:
      'What field in a Chrome extension manifest.json controls which URLs the extension is allowed to make fetch requests to?',
    keywords: ['host_permissions'],
  },
  {
    id: 'p8',
    prompt:
      'Write a JavaScript expression to calculate tokens per second from an Ollama API response, ' +
      'using the fields eval_count (number of tokens) and eval_duration (duration in nanoseconds).',
    keywords: ['eval_count', 'eval_duration', '1e9'],
  },
  {
    id: 'p9',
    prompt:
      'Write Express.js middleware to parse JSON request bodies with a maximum size limit of 1mb.',
    keywords: ['bodyParser', 'json', '1mb'],
  },
  {
    id: 'p10',
    prompt:
      'What does SQLite PRAGMA journal_mode=WAL do? Explain briefly.',
    keywords: ['WAL', 'write'],
  },
  {
    id: 'p11',
    prompt:
      'Which Recharts component is used to render a bar chart?',
    keywords: ['BarChart'],
  },
  {
    id: 'p12',
    prompt:
      'Write a TypeScript interface called BenchmarkRun with the following fields: ' +
      'id (number), model_name (string), score (number), created_at (string).',
    keywords: ['interface', 'BenchmarkRun', 'model_name', 'score'],
  },
  {
    id: 'p13',
    prompt:
      'What does chrome.alarms.create() do in a Chrome extension? Explain briefly.',
    keywords: ['alarm', 'schedule'],
  },
  {
    id: 'p14',
    prompt:
      'What does a requireUser middleware function typically do in an Express.js API?',
    keywords: ['authenticate', 'user'],
  },
  {
    id: 'p15',
    prompt:
      'Write a JavaScript fetch call that sends a POST request to /api/benchmarks with an Authorization Bearer token ' +
      'and a JSON body. Include JSON.stringify for the body.',
    keywords: ['fetch', '/api/benchmarks', 'Authorization', 'Bearer', 'JSON.stringify'],
  },
];

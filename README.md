# TheFlowrist

A minimal production-ready starter for TheFlowrist with:
- a simple secure HTTP server
- health endpoint for deployment checks
- automated tests
- container support
- CI workflow
- security checklist

## Run locally
```bash
npm install
npm start
```

## Test
```bash
npm test
```

## Docker
```bash
docker build -t theflowrist .
docker run -p 3000:3000 theflowrist
```

## Next steps
- add authentication and authorization
- add a real database and persistence layer
- add rate limiting and structured logging
- configure branch protection and deployment secrets

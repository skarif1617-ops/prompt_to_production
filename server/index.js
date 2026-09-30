import 'dotenv/config'
import process from 'node:process'
import { app } from './app.js'

const port = Number(process.env.API_PORT || 8787)
app.listen(port, '0.0.0.0', () => {
  console.log(`StudentAI Navigator API listening on ${port}`)
})

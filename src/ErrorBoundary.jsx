import { Component } from 'react'

export default class ErrorBoundary extends Component {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      return <main className="app-error-boundary"><div className="eyebrow muted">TEMPORARY ISSUE</div><h1>This screen could not load.</h1><p>Your saved practice remains on this device. Reload the app to continue.</p><button className="primary-small" onClick={() => window.location.reload()}>Reload app</button></main>
    }
    return this.props.children
  }
}
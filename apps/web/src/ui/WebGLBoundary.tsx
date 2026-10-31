import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  fallback: ReactNode;
  onFail?: () => void;
  children: ReactNode;
}

/**
 * Проверка возможностей браузера не гарантирует, что контекст WebGL действительно создастся.
 * Сбой 3D не должен закрывать доступ к книгам: вместо сцены показывается плоская версия.
 */
export class WebGLBoundary extends Component<Props, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('3D недоступно, включён плоский режим:', error, info.componentStack);
    this.props.onFail?.();
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

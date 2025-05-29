"use client";
import React from "react";
import { AlertTriangle, RefreshCw, Home, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorId: null,
    };
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render will show the fallback UI
    return {
      hasError: true,
      errorId: `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    };
  }

  componentDidCatch(error, errorInfo) {
    // Log error to console and potentially to an error reporting service
    console.error("ErrorBoundary caught an error:", error, errorInfo);

    this.setState({
      error,
      errorInfo,
    });

    // You can also log the error to an error reporting service here
    if (typeof window !== "undefined" && window.gtag) {
      window.gtag("event", "exception", {
        description: error.toString(),
        fatal: false,
      });
    }
  }

  handleRetry = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      errorId: null,
    });
  };

  handleGoHome = () => {
    if (typeof window !== "undefined") {
      window.location.href = "/";
    }
  };

  handleRefresh = () => {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  render() {
    if (this.state.hasError) {
      const {
        title = "Something went wrong",
        message = "We're sorry, but something unexpected happened. Please try again.",
        showDetails = false,
        showRetry = true,
        showRefresh = true,
        showHome = true,
        className = "",
      } = this.props;

      return (
        <div
          className={`flex items-center justify-center min-h-[400px] p-4 ${className}`}
        >
          <Card className="w-full max-w-lg">
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
                <AlertTriangle className="h-8 w-8 text-red-600" />
              </div>
              <CardTitle className="text-xl font-semibold text-gray-900">
                {title}
              </CardTitle>
            </CardHeader>

            <CardContent className="space-y-4">
              <p className="text-center text-gray-600">{message}</p>

              {this.state.errorId && (
                <div className="rounded-md bg-gray-50 p-3">
                  <p className="text-sm text-gray-500">
                    Error ID:{" "}
                    <code className="font-mono">{this.state.errorId}</code>
                  </p>
                </div>
              )}

              {showDetails && this.state.error && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-sm font-medium text-gray-700 hover:text-gray-900">
                    Technical Details
                  </summary>
                  <div className="mt-2 rounded-md bg-gray-50 p-3">
                    <pre className="text-xs text-gray-600 overflow-auto max-h-40">
                      {this.state.error.toString()}
                      {this.state.errorInfo.componentStack}
                    </pre>
                  </div>
                </details>
              )}

              <div className="flex flex-col gap-2 pt-4">
                {showRetry && (
                  <Button onClick={this.handleRetry} className="w-full">
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Try Again
                  </Button>
                )}

                <div className="flex gap-2">
                  {showRefresh && (
                    <Button
                      variant="outline"
                      onClick={this.handleRefresh}
                      className="flex-1"
                    >
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Refresh Page
                    </Button>
                  )}

                  {showHome && (
                    <Button
                      variant="outline"
                      onClick={this.handleGoHome}
                      className="flex-1"
                    >
                      <Home className="mr-2 h-4 w-4" />
                      Go Home
                    </Button>
                  )}
                </div>

                <p className="text-xs text-center text-gray-500 mt-4">
                  If this problem persists, please{" "}
                  <a
                    href="mailto:support@gioiabeauty.net"
                    className="text-blue-600 hover:text-blue-800 underline"
                  >
                    contact support
                  </a>
                  {this.state.errorId &&
                    ` and include the error ID: ${this.state.errorId}`}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

// Convenience wrapper for specific components
export const AppointmentErrorBoundary = ({ children }) => (
  <ErrorBoundary
    title="Appointment System Error"
    message="There was an error with the appointment system. Please try again or contact support if the problem persists."
    showDetails={process.env.NODE_ENV === "development"}
  >
    {children}
  </ErrorBoundary>
);

// Wrapper for dashboard components
export const DashboardErrorBoundary = ({ children }) => (
  <ErrorBoundary
    title="Dashboard Error"
    message="There was an error loading the dashboard. Please refresh the page or try again later."
    showDetails={process.env.NODE_ENV === "development"}
  >
    {children}
  </ErrorBoundary>
);

// Wrapper for booking components
export const BookingErrorBoundary = ({ children }) => (
  <ErrorBoundary
    title="Booking System Error"
    message="There was an error with the booking system. Please try refreshing the page."
    showDetails={process.env.NODE_ENV === "development"}
    showHome={true}
  >
    {children}
  </ErrorBoundary>
);

// Global error boundary for the entire app
export const GlobalErrorBoundary = ({ children }) => (
  <ErrorBoundary
    title="Application Error"
    message="Something unexpected happened. Please refresh the page or try again later."
    showDetails={process.env.NODE_ENV === "development"}
    showHome={true}
    showRetry={false}
  >
    {children}
  </ErrorBoundary>
);

export default ErrorBoundary;

import { type InputHTMLAttributes, type TextareaHTMLAttributes, forwardRef, useId } from "react";
import { cn } from "./utils";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  showCharCount?: boolean;
  maxCharCount?: number;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, showCharCount, maxCharCount, className, value, id, ...props }, ref) => {
    const currentLength = typeof value === "string" ? value.length : 0;
    const generatedId = useId();
    const inputId = id ?? generatedId;

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="block text-sm font-medium text-gray-700 mb-1">
            {label}
          </label>
        )}
        <input
          id={inputId}
          ref={ref}
          value={value}
          className={cn(
            "w-full px-3 py-2 border rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed",
            error ? "border-red-500" : "border-gray-300",
            className
          )}
          {...props}
        />
        <div className="flex items-center justify-between mt-1">
          {error && <p className="text-sm text-red-600">{error}</p>}
          {showCharCount && maxCharCount && (
            <p
              className={cn(
                "text-sm ml-auto",
                currentLength > maxCharCount ? "text-red-600" : "text-gray-500"
              )}
            >
              {currentLength} / {maxCharCount}
            </p>
          )}
        </div>
      </div>
    );
  }
);

Input.displayName = "Input";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  showCharCount?: boolean;
  maxCharCount?: number;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, showCharCount, maxCharCount, className, value, id, ...props }, ref) => {
    const currentLength = typeof value === "string" ? value.length : 0;
    const generatedId = useId();
    const textareaId = id ?? generatedId;

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={textareaId} className="block text-sm font-medium text-gray-700 mb-1">
            {label}
          </label>
        )}
        <textarea
          id={textareaId}
          ref={ref}
          value={value}
          className={cn(
            "w-full px-3 py-2 border rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed resize-none",
            error ? "border-red-500" : "border-gray-300",
            className
          )}
          {...props}
        />
        <div className="flex items-center justify-between mt-1">
          {error && <p className="text-sm text-red-600">{error}</p>}
          {showCharCount && maxCharCount && (
            <p
              className={cn(
                "text-sm ml-auto",
                currentLength > maxCharCount ? "text-red-600" : "text-gray-500"
              )}
            >
              {currentLength} / {maxCharCount}
            </p>
          )}
        </div>
      </div>
    );
  }
);

Textarea.displayName = "Textarea";

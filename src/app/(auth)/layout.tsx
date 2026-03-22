export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4">
      {/* Background gradient effect */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 -left-1/4 w-96 h-96 bg-[#1DA1F2]/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 -right-1/4 w-96 h-96 bg-[#1DA1F2]/10 rounded-full blur-3xl" />
      </div>

      {/* Content */}
      <div className="relative w-full max-w-md">
        <div className="mb-8 text-center">
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="h-10 w-10 mx-auto mb-8 fill-[#1DA1F2]"
          >
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
          <h1 className="text-3xl font-bold text-white mb-2">Happening now</h1>
        </div>

        <div className="bg-black border border-gray-800 rounded-2xl p-8 shadow-2xl backdrop-blur-sm">
          {children}
        </div>
      </div>
    </div>
  );
}

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 items-center justify-center bg-cream px-6 py-16">
      {children}
    </div>
  );
}

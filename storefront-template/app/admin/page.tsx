// Reached only after middleware.ts verifies the admin JWT — see
// storefront-template/middleware.ts for the actual gate.
export default function AdminPage() {
  return (
    <main>
      <h1>__BUSINESS_NAME__ admin</h1>
      <p>You have a valid admin session.</p>
    </main>
  );
}

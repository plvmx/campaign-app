'use client';

export default function DebugPage() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Deployment Debug Info</h1>
      
      <div className="space-y-4">
        <div>
          <h2 className="font-semibold mb-2">Environment Variables:</h2>
          <div className="bg-gray-100 p-4 rounded">
            <p><strong>NEXT_PUBLIC_SUPABASE_URL:</strong> {supabaseUrl ? '✅ Set' : '❌ Missing'}</p>
            <p><strong>NEXT_PUBLIC_SUPABASE_ANON_KEY:</strong> {supabaseKey ? '✅ Set' : '❌ Missing'}</p>
          </div>
        </div>

        <div>
          <h2 className="font-semibold mb-2">Current URL:</h2>
          <div className="bg-gray-100 p-4 rounded">
            <p>{typeof window !== 'undefined' ? window.location.href : 'Server-side'}</p>
          </div>
        </div>

        <div>
          <h2 className="font-semibold mb-2">Expected App Structure:</h2>
          <div className="bg-gray-100 p-4 rounded">
            <ul className="list-disc list-inside space-y-1">
              <li>Root (/) → Redirects to /login or /app</li>
              <li>/login → Login form with mobile and first name</li>
              <li>/app → Main dashboard with campaign list</li>
              <li>/capture → Create new campaign</li>
              <li>/results → View campaign results</li>
              <li>/admin → Admin panel (if admin user)</li>
            </ul>
          </div>
        </div>

        <div>
          <h2 className="font-semibold mb-2">If you see different content:</h2>
          <div className="bg-yellow-100 p-4 rounded">
            <ol className="list-decimal list-inside space-y-1">
              <li>Check you're on the correct Vercel URL</li>
              <li>Verify environment variables are set in Vercel</li>
              <li>Clear Vercel build cache and redeploy</li>
              <li>Hard refresh browser (Ctrl+Shift+R)</li>
              <li>Check browser console for errors</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}

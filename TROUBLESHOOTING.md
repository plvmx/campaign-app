# Troubleshooting Deployment Issues

## Issue: "Failed to authenticate" or "Authentication failed" on Login

If login works locally but fails on Vercel:

### 1. Enable Anonymous Sign-In in Supabase

The app uses anonymous authentication. It must be enabled:

1. Go to **Supabase Dashboard** → **Authentication** → **Providers**
2. Find **Anonymous** (or "Anonymous sign-ins")
3. **Enable** it if it is off

### 2. Add SUPABASE_SERVICE_ROLE_KEY to Vercel

Login validation runs server-side and needs the service role key:

1. Vercel → **Settings** → **Environment Variables**
2. Add `SUPABASE_SERVICE_ROLE_KEY` = your service role key from Supabase (Settings → API)
3. Redeploy after adding (Deployments → ⋮ → Redeploy)

### 3. Configure Supabase Redirect URLs

1. Supabase → **Authentication** → **URL Configuration**
2. Add your Vercel URL to **Redirect URLs**: `https://your-app.vercel.app/*`
3. Set **Site URL** to your Vercel URL

### 4. Check the Full Error Message

Open the browser console (F12 → Console) when login fails. The full Supabase error message may help pinpoint the cause.

---

## Issue: Seeing Wrong Content After Deployment

If you're seeing content that doesn't match your app (e.g., "Campaign Test", "Campaign List", "Address" boxes), follow these steps:

### Step 1: Verify Environment Variables

**Critical:** The app requires Supabase environment variables to work. Without them, it may show errors or fallback content.

1. Go to your Vercel project dashboard
2. Navigate to **Settings** → **Environment Variables**
3. Verify these are set:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. **After adding/updating variables, you MUST redeploy:**
   - Go to **Deployments** tab
   - Click **"..."** on the latest deployment
   - Select **"Redeploy"**

### Step 2: Clear Vercel Build Cache

1. In Vercel dashboard, go to **Settings** → **General**
2. Scroll to **"Clear Build Cache"**
3. Click **"Clear"**
4. Trigger a new deployment

### Step 3: Force a Fresh Deployment

1. Make a small change to your code (e.g., add a comment)
2. Commit and push to GitHub:
   ```bash
   git add .
   git commit -m "Force redeploy"
   git push origin main
   ```
3. Vercel will automatically deploy the new version

### Step 4: Verify You're on the Correct URL

- The app should redirect you to `/login` if not authenticated
- After login, you should be at `/app`
- Check the URL in your browser's address bar

### Step 5: Check Browser Console for Errors

1. Open your browser's Developer Tools (F12)
2. Go to the **Console** tab
3. Look for errors, especially:
   - Supabase connection errors
   - Missing environment variables
   - Authentication errors

### Step 6: Check Vercel Build Logs

1. In Vercel dashboard, go to **Deployments**
2. Click on the latest deployment
3. Check the **Build Logs** for any errors
4. Look for:
   - Build failures
   - Missing environment variables
   - TypeScript errors

### Step 7: Verify Supabase Configuration

1. Go to Supabase Dashboard → **Authentication** → **URL Configuration**
2. Verify **Redirect URLs** include:
   - `https://your-app-name.vercel.app/auth/callback`
   - `https://your-app-name.vercel.app/app`
3. Verify **Site URL** is set to:
   - `https://your-app-name.vercel.app`

### Step 8: Test Locally First

Before deploying, verify the app works locally:

```bash
# Set environment variables in .env.local
NEXT_PUBLIC_SUPABASE_URL=your_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_key

# Build and test
npm run build
npm start
```

Visit `http://localhost:3000` and verify it works correctly.

## Common Issues

### Issue: "Loading..." Screen Forever

**Cause:** Supabase environment variables not set or incorrect

**Solution:**
1. Verify environment variables in Vercel
2. Check Supabase project is active
3. Verify Supabase URL and anon key are correct

### Issue: Redirect Loop

**Cause:** Supabase redirect URLs not configured

**Solution:**
1. Add production URLs to Supabase redirect URLs
2. Ensure Site URL matches your Vercel domain

### Issue: Seeing Old/Stale Content

**Cause:** Browser or Vercel cache

**Solution:**
1. Hard refresh browser (Ctrl+Shift+R or Cmd+Shift+R)
2. Clear Vercel build cache
3. Force a new deployment

### Issue: TypeScript/Build Errors

**Cause:** Code errors preventing successful build

**Solution:**
1. Run `npm run build` locally to catch errors
2. Fix all TypeScript errors
3. Commit and push fixes
4. Vercel will rebuild automatically

## Still Having Issues?

1. **Check Vercel Function Logs:**
   - Go to Vercel dashboard → **Functions** tab
   - Look for runtime errors

2. **Check Supabase Logs:**
   - Go to Supabase Dashboard → **Logs**
   - Look for authentication or database errors

3. **Verify Network Connectivity:**
   - Ensure your Supabase project is accessible
   - Check if there are any firewall/network restrictions

4. **Compare Local vs Production:**
   - Does the app work locally?
   - If yes, the issue is likely environment variables or deployment configuration
   - If no, fix local issues first

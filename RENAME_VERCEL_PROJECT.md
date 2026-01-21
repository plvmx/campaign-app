# How to Rename Your Vercel Project

## Step 1: Rename Project in Vercel Dashboard

1. Go to https://vercel.com/dashboard
2. Click on your `campaign-app` project
3. Go to **Settings** → **General**
4. Scroll down to find **"Project Name"**
5. Change it from `campaign-app` to `afj-campaign-app`
6. Click **"Save"**

## Step 2: Update Your New URL

After renaming, your app will be available at:
- **New URL**: `https://afj-campaign-app.vercel.app`
- Old URL (`campaign-app.vercel.app`) will stop working

## Step 3: Update Supabase Redirect URLs

After renaming, you need to update Supabase:

1. Go to Supabase Dashboard → **Authentication** → **URL Configuration**
2. Update **Redirect URLs** to:
   - `https://afj-campaign-app.vercel.app/auth/callback`
   - `https://afj-campaign-app.vercel.app/app`
3. Update **Site URL** to:
   - `https://afj-campaign-app.vercel.app`

## Step 4: Test the New URL

Visit: `https://afj-campaign-app.vercel.app/login`

You should now see:
- "AFJ Campaign Manager" heading
- Mobile Number and First Name input fields
- "Sign In" button

## Alternative: Check if You're on the Right Project

Before renaming, you can also verify:

1. In Vercel Dashboard, check the **Git** settings:
   - Repository should be: `plvmx/campaign-app`
   - Latest deployment should show your commits

2. Check the latest deployment:
   - Should show commit: "Fix: Wrap useSearchParams..."
   - Should be from `main` branch

If these don't match, you might be looking at the wrong project!

# Deployment Guide

This guide will help you deploy the Campaign Management App to Vercel (recommended) or other hosting platforms.

## Pre-Deployment Checklist

✅ **Completed:**
- [x] Fixed TypeScript errors in `app/app/page.tsx`
- [x] Fixed TypeScript errors in `lib/campaignLog.ts`
- [x] Verified no hardcoded localhost URLs
- [x] Verified environment variables are properly configured
- [x] Verified Next.js configuration is production-ready

## Environment Variables Required

Before deploying, ensure you have the following environment variables ready:

### Required:
- `NEXT_PUBLIC_SUPABASE_URL` - Your Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Your Supabase anonymous key
- `SUPABASE_SERVICE_ROLE_KEY` - Your Supabase **service role** key (required for login validation; bypasses RLS server-side)

  ➜ Find it in Supabase Dashboard → Settings → API → `service_role` key (keep secret, server-only)

### Optional:
- `NEXT_PUBLIC_ADMIN_EMAILS` - Comma-separated list of admin emails (for development/testing)

## Deployment to Vercel

### Step 1: Push Code to GitHub

```bash
git add .
git commit -m "Prepare for deployment"
git push origin main
```

### Step 2: Deploy to Vercel

1. Go to [vercel.com](https://vercel.com) and sign up/login with GitHub
2. Click **"Add New Project"**
3. Import your `campaign-app` repository
4. Vercel will auto-detect Next.js - no configuration needed
5. Click **"Deploy"**

### Step 3: Configure Environment Variables

1. In your Vercel project dashboard, go to **Settings** → **Environment Variables**
2. Add the following variables:
   - `NEXT_PUBLIC_SUPABASE_URL` = `your_supabase_project_url`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = `your_supabase_anon_key`
   - `SUPABASE_SERVICE_ROLE_KEY` = `your_supabase_service_role_key` ← **Required for login**
   - `NEXT_PUBLIC_ADMIN_EMAILS` = `admin@example.com` (optional)

3. **Important:** After adding variables, you need to redeploy:
   - Go to **Deployments** tab
   - Click the **"..."** menu on the latest deployment
   - Select **"Redeploy"**

### Step 4: Configure Supabase for Production

1. Go to your Supabase Dashboard → **Authentication** → **URL Configuration**
2. Add your production URLs to **Redirect URLs**:
   - `https://your-app-name.vercel.app/auth/callback`
   - `https://your-app-name.vercel.app/app`
3. Set **Site URL** to: `https://your-app-name.vercel.app`

### Step 5: Verify Deployment

1. Visit your deployed app: `https://your-app-name.vercel.app`
2. Test the login flow
3. Verify authentication redirects work correctly

## Post-Deployment

### Custom Domain (Optional)

1. In Vercel dashboard, go to **Settings** → **Domains**
2. Add your custom domain
3. Update Supabase redirect URLs to include your custom domain

### Monitoring

- Vercel provides built-in analytics on the Pro plan
- Check deployment logs in the Vercel dashboard if issues arise
- Monitor Supabase dashboard for database usage and errors

## Troubleshooting

### Build Errors

If you encounter build errors:
1. Check the build logs in Vercel dashboard
2. Ensure all TypeScript errors are resolved locally first
3. Run `npm run build` locally to catch errors before deploying

### Authentication Issues

If authentication doesn't work:
1. Verify environment variables are set correctly in Vercel
2. Check Supabase redirect URLs include your production domain
3. Ensure Supabase Site URL matches your production domain

### Environment Variable Issues

- Environment variables starting with `NEXT_PUBLIC_` are exposed to the browser
- Never commit sensitive keys (service role keys) to the repository
- Use Vercel's environment variable management for all secrets

## Cost Estimate

**Vercel Free Tier:**
- ✅ Unlimited personal projects
- ✅ 100GB bandwidth/month
- ✅ Automatic SSL
- ✅ Global CDN
- ✅ Serverless functions

**Upgrade to Pro ($20/month) if you need:**
- More bandwidth
- Team collaboration
- Advanced analytics
- Priority support

## Alternative Hosting Options

### Netlify
- Similar free tier to Vercel
- Good Next.js support
- Slightly different deployment process

### Railway
- $5/month after free credits
- Good for full-stack apps
- More control over infrastructure

### Render
- Free tier available
- Slower cold starts on free tier
- Good for simple deployments

## Support

For issues or questions:
1. Check Vercel documentation: https://vercel.com/docs
2. Check Next.js deployment guide: https://nextjs.org/docs/app/building-your-application/deploying
3. Review Supabase documentation: https://supabase.com/docs

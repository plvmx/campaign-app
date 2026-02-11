const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Load environment variables from .env.local
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
} catch (e) {
  try {
    const envPath = path.join(__dirname, '..', '.env.local');
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf-8');
      envContent.split('\n').forEach(line => {
        const trimmedLine = line.trim();
        if (trimmedLine && !trimmedLine.startsWith('#')) {
          const [key, ...valueParts] = trimmedLine.split('=');
          if (key && valueParts.length > 0) {
            const value = valueParts.join('=').trim().replace(/^["']|["']$/g, '');
            process.env[key.trim()] = value;
          }
        }
      });
    }
  } catch (err) {
    console.warn('Could not load .env.local file:', err.message);
  }
}

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (or SUPABASE_SERVICE_ROLE_KEY) must be set in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Day name to day of week mapping (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
const dayNameToNumber = {
  'Sunday': 0,
  'Monday': 1,
  'Tuesday': 2,
  'Wednesday': 3,
  'Thursday': 4,
  'Friday': 5,
  'Saturday': 6,
};

/**
 * Calculate Monday of the current week
 * Returns a Date object set to Monday 00:00:00
 */
function getMondayOfThisWeek() {
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // If Sunday, go back 6 days; otherwise go to Monday
  
  const monday = new Date(today);
  monday.setDate(today.getDate() + daysToMonday);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

/**
 * Calculate the date for a given week and day
 * Week 1 starts from Monday of this week
 * Days are mapped to actual weekdays, skipping days without records
 */
function calculateDate(week, dayName, mondayOfThisWeek) {
  const dayOfWeek = dayNameToNumber[dayName];
  if (dayOfWeek === undefined) {
    throw new Error(`Invalid day name: ${dayName}`);
  }
  
  // Week 1 starts from Monday (day 1)
  // Calculate the date: Monday + (week - 1) * 7 days + (dayOfWeek - 1) days
  const date = new Date(mondayOfThisWeek);
  date.setDate(mondayOfThisWeek.getDate() + (week - 1) * 7 + (dayOfWeek - 1));
  
  return date;
}

/**
 * Format date as YYYY-MM-DD
 */
function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Parse time string and convert to HH:MM format (24-hour)
 * Handles formats like "11:00 am", "2:00 pm", "12:30 am", etc.
 */
function parseTime(timeStr) {
  if (!timeStr) return null;
  
  const trimmed = timeStr.trim().toLowerCase();
  
  // Remove spaces and extract parts
  const match = trimmed.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/);
  if (!match) {
    // Try format without am/pm
    const simpleMatch = trimmed.match(/(\d{1,2}):(\d{2})/);
    if (simpleMatch) {
      const hours = parseInt(simpleMatch[1], 10);
      const minutes = parseInt(simpleMatch[2], 10);
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }
    return null;
  }
  
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const ampm = match[3];
  
  if (ampm === 'pm' && hours !== 12) {
    hours += 12;
  } else if (ampm === 'am' && hours === 12) {
    hours = 0;
  }
  
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Parse CSV line handling quoted fields
 */
function parseCSVLine(line) {
  const parts = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      parts.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current.trim());
  return parts;
}

async function loadCampaigns() {
  try {
    // Delete all existing campaigns
    console.log('Deleting all existing campaigns...');
    // First, get count of existing records
    const { count } = await supabase
      .from('campaigns')
      .select('*', { count: 'exact', head: true });
    
    if (count > 0) {
      // Delete all records - we'll use a condition that matches all
      // Since we can't use delete without a filter in Supabase, we'll delete in batches
      // or use a workaround
      const { error: deleteError } = await supabase
        .from('campaigns')
        .delete()
        .gte('created_at', '1970-01-01'); // Delete all records (created_at is always >= 1970)
      
      if (deleteError) {
        console.error('Error deleting existing campaigns:', deleteError);
        process.exit(1);
      }
      console.log(`Deleted ${count} existing campaigns.`);
    } else {
      console.log('No existing campaigns to delete.');
    }
    
    // Read the CSV file
    const csvPath = path.join(__dirname, '..', 'campaigns.csv');
    if (!fs.existsSync(csvPath)) {
      console.error(`Error: campaigns.csv not found at ${csvPath}`);
      process.exit(1);
    }
    
    const csvContent = fs.readFileSync(csvPath, 'utf-8');
    const lines = csvContent.trim().split('\n');
    
    // Skip header row
    const dataLines = lines.slice(1);
    
    // Calculate Monday of this week
    const mondayOfThisWeek = getMondayOfThisWeek();
    console.log(`Using Monday of this week as base: ${formatDate(mondayOfThisWeek)}`);
    
    // Parse CSV data
    const campaigns = [];
    for (const line of dataLines) {
      if (!line.trim()) continue;
      
      const parts = parseCSVLine(line);
      if (parts.length < 8) {
        console.warn(`Skipping invalid line: ${line}`);
        continue;
      }
      
      const [weekStr, dayName, state, place, timeStr, leader, mobile, botjStr] = parts;
      
      if (!weekStr || !dayName || !state || !place || !timeStr || !leader) {
        console.warn(`Skipping incomplete record: ${line}`);
        continue;
      }
      
      const week = parseInt(weekStr, 10);
      if (isNaN(week)) {
        console.warn(`Skipping record with invalid week: ${line}`);
        continue;
      }
      
      // Calculate date from week and day
      const date = calculateDate(week, dayName, mondayOfThisWeek);
      const dateStr = formatDate(date);
      
      // Parse time
      const time = parseTime(timeStr);
      if (!time) {
        console.warn(`Skipping record with invalid time: ${line}`);
        continue;
      }
      
      // Clean mobile: set to null if empty, "-", or "?"
      const cleanMobile = mobile && mobile.trim() && mobile.trim() !== '-' && mobile.trim() !== '?'
        ? mobile.trim()
        : null;
      
      // Parse BOTJ (default to 0)
      const botj = botjStr ? parseInt(botjStr, 10) : 0;
      const botjValue = isNaN(botj) ? 0 : botj;
      
      campaigns.push({
        date: dateStr,
        state: state.trim(),
        place: place.trim(),
        time: time,
        leader: leader.trim(),
        mobile: cleanMobile,
        botj: botjValue,
        source: 'MAN',
        // Note: user_id will be null for imported campaigns
        // You may want to set a default system user_id if needed
      });
    }
    
    console.log(`Found ${campaigns.length} campaigns to load`);
    
    if (campaigns.length === 0) {
      console.log('No campaigns to load.');
      return;
    }
    
    // Insert data into Supabase in batches (Supabase has limits on batch size)
    const batchSize = 100;
    let totalInserted = 0;
    
    for (let i = 0; i < campaigns.length; i += batchSize) {
      const batch = campaigns.slice(i, i + batchSize);
      const { data, error } = await supabase
        .from('campaigns')
        .insert(batch)
        .select();
      
      if (error) {
        console.error(`Error loading batch ${Math.floor(i / batchSize) + 1}:`, error);
        console.error('Failed batch:', batch);
        process.exit(1);
      }
      
      totalInserted += data.length;
      console.log(`Loaded batch ${Math.floor(i / batchSize) + 1}: ${data.length} campaigns (${totalInserted}/${campaigns.length})`);
    }
    
    console.log(`\nSuccessfully loaded ${totalInserted} campaigns into campaigns table`);
    console.log('Sample records:');
    console.log(campaigns.slice(0, 5).map(c => ({
      date: c.date,
      state: c.state,
      place: c.place,
      time: c.time,
      leader: c.leader
    })));
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Run the script
loadCampaigns();


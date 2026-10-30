using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

// A read-only helper. It never activates, moves, hooks, or injects into a window.
// It keeps all native rectangles in physical pixels, independently of Electron's DIP bounds.
internal static class FullscreenWatcher
{
    [StructLayout(LayoutKind.Sequential)]
    private struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)]
    private struct MonitorInfo { public int Size; public Rect Monitor, Work; public uint Flags; }

    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern IntPtr GetShellWindow();
    [DllImport("user32.dll")] private static extern IntPtr GetDesktopWindow();
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] private static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder text, int length);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")] private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] private static extern bool SetProcessDPIAware();
    [DllImport("dwmapi.dll", EntryPoint = "DwmGetWindowAttribute")] private static extern int GetFrameBounds(IntPtr window, int attribute, out Rect rect, int size);
    [DllImport("dwmapi.dll", EntryPoint = "DwmGetWindowAttribute")] private static extern int GetCloaked(IntPtr window, int attribute, out uint cloaked, int size);
    [DllImport("shell32.dll")] private static extern int SHQueryUserNotificationState(out int state);

    private static bool CoversMonitor(Rect window, Rect monitor)
    {
        const int tolerance = 2;
        return monitor.Right > monitor.Left && monitor.Bottom > monitor.Top && window.Right > window.Left && window.Bottom > window.Top
            && (long)window.Left <= (long)monitor.Left + tolerance && (long)window.Top <= (long)monitor.Top + tolerance
            && (long)window.Right >= (long)monitor.Right - tolerance && (long)window.Bottom >= (long)monitor.Bottom - tolerance;
    }

    private static bool IgnoredWindow(string name, uint processId, uint ownerId)
    {
        return processId == ownerId || name == "Progman" || name == "WorkerW" || name == "Shell_TrayWnd" || name == "Shell_SecondaryTrayWnd";
    }

    private static bool FullscreenNotification(int state) { return state == 2 || state == 3 || state == 4; }

    private static bool Blocked(uint ownerId)
    {
        int notification;
        if (SHQueryUserNotificationState(out notification) != 0) notification = 0;
        // Windows' fullscreen/exclusive/presentation state is global. Honor it
        // even while foreground activation temporarily moves to the shell.
        if (notification == 1 || FullscreenNotification(notification)) return true;
        IntPtr window = GetForegroundWindow();
        // Activation transitions can temporarily have no foreground window.
        // Keep the caption hidden for that sample instead of flashing over a game.
        if (window == IntPtr.Zero) return true;
        if (window == GetDesktopWindow() || window == GetShellWindow()) return false;
        uint processId;
        if (GetWindowThreadProcessId(window, out processId) == 0) return true;
        StringBuilder name = new StringBuilder(128);
        GetClassName(window, name, name.Capacity);
        if (IgnoredWindow(name.ToString(), processId, ownerId) || !IsWindowVisible(window) || IsIconic(window)) return false;
        uint cloaked;
        if (GetCloaked(window, 14, out cloaked, 4) == 0 && cloaked != 0) return false;
        MonitorInfo monitor = new MonitorInfo();
        monitor.Size = Marshal.SizeOf(typeof(MonitorInfo));
        Rect bounds;
        bool hasBounds = GetFrameBounds(window, 9, out bounds, Marshal.SizeOf(typeof(Rect))) == 0;
        if (!hasBounds || bounds.Right <= bounds.Left || bounds.Bottom <= bounds.Top) hasBounds = GetWindowRect(window, out bounds);
        if (!hasBounds || !GetMonitorInfo(MonitorFromWindow(window, 2), ref monitor)) return true;
        if (CoversMonitor(bounds, monitor.Monitor)) return true;
        return false;
    }

    private static Rect Rectangle(int left, int top, int right, int bottom) { return new Rect { Left = left, Top = top, Right = right, Bottom = bottom }; }
    private static int SelfTest()
    {
        int count = 0;
        Action<bool> check = delegate(bool passed) { if (!passed) throw new InvalidOperationException("Fullscreen classifier self-test failed at " + (count + 1)); count++; };
        Rect monitor = Rectangle(0, 0, 2560, 1440);
        check(CoversMonitor(monitor, monitor));
        check(!CoversMonitor(Rectangle(0, 0, 2560, 1368), monitor)); // maximized at 150% DPI, 72px taskbar
        check(!CoversMonitor(Rectangle(0, 0, 1707, 960), monitor)); // DIP must not be mixed with native pixels
        check(CoversMonitor(Rectangle(-8, -8, 2568, 1448), monitor));
        check(CoversMonitor(Rectangle(2, 2, 2558, 1438), monitor));
        check(!CoversMonitor(Rectangle(3, 0, 2560, 1440), monitor));
        check(CoversMonitor(Rectangle(-2560, -1440, 0, 0), Rectangle(-2560, -1440, 0, 0)));
        check(!CoversMonitor(Rectangle(-2560, -1440, 0, -72), Rectangle(-2560, -1440, 0, 0)));
        check(!CoversMonitor(Rectangle(0, 0, 0, 0), monitor));
        check(IgnoredWindow("Progman", 5, 9));
        check(IgnoredWindow("WorkerW", 5, 9));
        check(IgnoredWindow("Shell_TrayWnd", 5, 9));
        check(IgnoredWindow("Shell_SecondaryTrayWnd", 5, 9));
        check(IgnoredWindow("Chrome_WidgetWin_1", 9, 9));
        check(!IgnoredWindow("Chrome_WidgetWin_1", 5, 9));
        check(FullscreenNotification(2));
        check(FullscreenNotification(3));
        check(FullscreenNotification(4));
        check(!FullscreenNotification(5));
        check(!FullscreenNotification(6));
        Console.WriteLine("{\"passed\":true,\"checks\":" + count + "}");
        return 0;
    }

    private static int Main(string[] args)
    {
        try
        {
            if (args.Length == 1 && args[0] == "--self-test") return SelfTest();
            int ownerId;
            if (args.Length != 1 || !Int32.TryParse(args[0], out ownerId) || ownerId <= 0) return 2;
            using (Process parent = Process.GetProcessById(ownerId))
            {
                try
                {
                    if (SetThreadDpiAwarenessContext(new IntPtr(-4)) == IntPtr.Zero && SetThreadDpiAwarenessContext(new IntPtr(-3)) == IntPtr.Zero) SetProcessDPIAware();
                }
                catch (EntryPointNotFoundException) { SetProcessDPIAware(); }
                while (!parent.HasExited)
                {
                    Console.WriteLine(Blocked((uint)ownerId) ? "1" : "0");
                    Console.Out.Flush();
                    Thread.Sleep(250);
                }
            }
            return 0;
        }
        catch { return 1; } // No process names, titles, or window content are logged.
    }
}
